"""Real Chromium smoke for generic keyboard/focus contracts in the package-local gallery."""

import argparse
import json

from playwright.sync_api import sync_playwright


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:4175/")
    parser.add_argument("--screenshot", default="/tmp/gooddealer-ui-gallery.png")
    args = parser.parse_args()

    evidence: dict[str, object] = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1100})
        console_errors: list[str] = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: console_errors.append(str(error)))
        page.goto(args.url, wait_until="domcontentloaded")

        opener = page.get_by_role("button", name="Open dialog")
        opener.click()
        close = page.get_by_role("button", name="Close")
        assert close.evaluate("element => element === document.activeElement")
        close.press("Shift+Tab")
        assert page.get_by_role("button", name="Primary").evaluate("element => element === document.activeElement")
        page.get_by_role("button", name="Primary").press("Tab")
        assert close.evaluate("element => element === document.activeElement")
        close.press("Escape")
        assert not page.get_by_role("dialog", name="Keyboard contract").is_visible()
        assert opener.evaluate("element => element === document.activeElement")
        evidence["dialog"] = "focus-entered; shift-tab/tab trapped; escape closed; opener restored"

        page.get_by_role("button", name="Command menu").click()
        command_input = page.get_by_placeholder("Search or enter a command…")
        page.wait_for_function(
            "document.activeElement?.getAttribute('placeholder') === 'Search or enter a command…'"
        )
        assert command_input.evaluate("element => element === document.activeElement")
        command_input.press("ArrowDown")
        command_input.press("Enter")
        assert page.get_by_test_id("gallery-status").inner_text() == "command-review"
        page.get_by_role("button", name="Command menu").click()
        command_input.press("Escape")
        assert page.get_by_test_id("gallery-status").inner_text() == "command-closed"
        evidence["commandMenu"] = "autofocus; arrow selection; enter activation; escape close"

        local = page.get_by_role("radio", name="Local")
        local.focus()
        local.press("ArrowRight")
        assert page.get_by_role("radio", name="Cloud").get_attribute("aria-checked") == "true"
        evidence["segmentedControl"] = "roving arrow selection"

        edit_button = page.get_by_role("button", name="Edit valuation")
        edit_button.press("Enter")
        edit_input = page.get_by_label("Edit valuation")
        edit_input.fill("999")
        edit_input.press("Escape")
        assert page.get_by_role("button", name="Edit valuation").inner_text() == "$1,200.00"
        page.get_by_role("button", name="Edit valuation").dblclick()
        page.get_by_label("Edit valuation").fill("1375")
        page.get_by_label("Edit valuation").press("Enter")
        assert page.get_by_test_id("gallery-status").inner_text() == "edited-1375"
        evidence["editableCell"] = "enter/F2 edit seam; escape cancel; enter commit"

        clear = page.get_by_role("button", name="Clear")
        clear.focus()
        page.keyboard.press("Space")
        assert page.get_by_test_id("gallery-status").inner_text() == "cleared"
        opener.focus()
        page.keyboard.press("Enter")
        assert page.get_by_test_id("gallery-status").inner_text() == "dialog-open"
        page.get_by_role("button", name="Close").press("Escape")
        evidence["nativeButtons"] = "space and enter activation"

        page.screenshot(path=args.screenshot, full_page=True)
        evidence["screenshot"] = args.screenshot
        assert not console_errors, console_errors
        evidence["consoleErrors"] = console_errors
        browser.close()

    print(json.dumps(evidence, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()

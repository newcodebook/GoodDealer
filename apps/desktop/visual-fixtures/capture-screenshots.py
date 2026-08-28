#!/usr/bin/env python3
"""Capture every declared visual fixture case and update its manifest digest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

try:
    from playwright.sync_api import ConsoleMessage, Error, Page, sync_playwright
except ModuleNotFoundError as error:
    raise SystemExit(
        "Playwright is required from the existing developer/browser runtime; "
        "no repository dependency is installed by this script."
    ) from error


FIXTURE_ROOT = Path(__file__).resolve().parent
DESKTOP_ROOT = FIXTURE_ROOT.parent
MANIFEST_PATH = FIXTURE_ROOT / "screenshots" / "manifest.json"
CASE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
EXPECTED_PRESENTATION_COUNT = 6
EXPECTED_CASE_COUNT = 34


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture the complete GoodDealer desktop visual fixture manifest."
    )
    parser.add_argument(
        "--base-url",
        help="Reuse an already-running fixture server instead of starting isolated Vite.",
    )
    parser.add_argument(
        "--chrome-executable",
        help="Chrome/Chromium executable; defaults to GOODDEALER_CHROME_EXECUTABLE or discovery.",
    )
    return parser.parse_args()


def load_manifest() -> dict[str, Any]:
    with MANIFEST_PATH.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if value.get("schemaVersion") != 1:
        raise RuntimeError("unsupported visual fixture manifest")
    if set(value) != {"schemaVersion", "canary", "catalogIntent", "presentations"}:
        raise RuntimeError("visual fixture manifest has missing or unknown top-level fields")
    if len(value.get("presentations", [])) != EXPECTED_PRESENTATION_COUNT:
        raise RuntimeError("visual fixture manifest must declare exactly 6 presentations")
    return value


def reserve_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def wait_for_server(base_url: str, process: subprocess.Popen[bytes] | None) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise RuntimeError(f"fixture server exited with code {process.returncode}")
        try:
            with urlopen(base_url, timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, URLError):
            time.sleep(0.1)
    raise RuntimeError(f"fixture server did not become ready: {base_url}")


def start_server() -> tuple[str, subprocess.Popen[bytes]]:
    port = reserve_port()
    process = subprocess.Popen(
        [
            "pnpm",
            "exec",
            "vite",
            "--config",
            "vite.visual.config.ts",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--strictPort",
        ],
        cwd=DESKTOP_ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    base_url = f"http://127.0.0.1:{port}/"
    wait_for_server(base_url, process)
    return base_url, process


def discover_chrome(explicit: str | None) -> str:
    candidates = [
        explicit,
        os.environ.get("GOODDEALER_CHROME_EXECUTABLE"),
        shutil.which("google-chrome"),
        shutil.which("google-chrome-stable"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate).resolve())
    raise RuntimeError(
        "Chrome/Chromium was not found; pass --chrome-executable or set "
        "GOODDEALER_CHROME_EXECUTABLE."
    )


def iter_cases(manifest: dict[str, Any]):
    seen_ids: set[str] = set()
    seen_files: set[str] = set()
    for presentation in manifest["presentations"]:
        viewport = presentation["viewport"]
        for fixture_case in presentation["cases"]:
            case_id = fixture_case["id"]
            relative_file = fixture_case["screenshot"]["file"]
            if not CASE_ID_PATTERN.fullmatch(case_id):
                raise RuntimeError(f"unsafe case id: {case_id}")
            if case_id in seen_ids or relative_file in seen_files:
                raise RuntimeError(f"duplicate case id or screenshot path: {case_id}")
            if relative_file != f"screenshots/{case_id}.png":
                raise RuntimeError(f"screenshot path must be derived from case id: {case_id}")
            seen_ids.add(case_id)
            seen_files.add(relative_file)
            yield fixture_case, int(viewport["width"]), int(viewport["height"])


def capture_case(
    page: Page,
    base_url: str,
    fixture_case: dict[str, Any],
    width: int,
    height: int,
    output_path: Path,
) -> str:
    case_id = fixture_case["id"]
    console_errors: list[str] = []
    page_errors: list[str] = []
    request_errors: list[str] = []

    def record_console(message: ConsoleMessage) -> None:
        if message.type == "error":
            console_errors.append(message.text)

    def record_page_error(error: Error) -> None:
        page_errors.append(str(error))

    def record_request_failure(request: Any) -> None:
        failure = request.failure
        request_errors.append(f"{request.method} {request.url}: {failure}")

    def record_response(response: Any) -> None:
        if response.status >= 400:
            request_errors.append(f"{response.status} {response.url}")

    page.on("console", record_console)
    page.on("pageerror", record_page_error)
    page.on("requestfailed", record_request_failure)
    page.on("response", record_response)
    try:
        page.set_viewport_size({"width": width, "height": height})
        response = page.goto(
            f"{base_url}?case={case_id}&capture=1",
            wait_until="networkidle",
            timeout=30_000,
        )
        if response is None or not response.ok:
            status = "no response" if response is None else str(response.status)
            raise RuntimeError(f"{case_id}: fixture navigation failed ({status})")
        try:
            page.locator(
                f'main.gd-fixture-capture[data-fixture-case="{case_id}"]'
            ).wait_for(state="visible", timeout=10_000)
        except Error as error:
            details = "; ".join([*console_errors, *page_errors, *request_errors])
            raise RuntimeError(
                f"{case_id}: fixture root did not render; browser={details or 'no browser error'}"
            ) from error
        page.evaluate(
            """async () => {
              await document.fonts.ready;
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }"""
        )
        if page.locator(".gd-fixture-unavailable").count() != 0:
            raise RuntimeError(f"{case_id}: unavailable fixture was rendered")
        if console_errors or page_errors or request_errors:
            details = "; ".join([*console_errors, *page_errors, *request_errors])
            raise RuntimeError(f"{case_id}: browser error: {details}")
        page.screenshot(
            path=output_path,
            full_page=False,
            animations="disabled",
            caret="hide",
            scale="css",
        )
    finally:
        page.remove_listener("console", record_console)
        page.remove_listener("pageerror", record_page_error)
        page.remove_listener("requestfailed", record_request_failure)
        page.remove_listener("response", record_response)

    payload = output_path.read_bytes()
    if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError(f"{case_id}: capture is not a PNG")
    return hashlib.sha256(payload).hexdigest()


def persist_captures(
    manifest: dict[str, Any], staged_directory: Path, digests: dict[str, str]
) -> None:
    expected_pngs: set[str] = set()
    for fixture_case, _width, _height in iter_cases(manifest):
        case_id = fixture_case["id"]
        screenshot = fixture_case["screenshot"]
        digest = digests[case_id]
        if not SHA256_PATTERN.fullmatch(digest):
            raise RuntimeError(f"invalid SHA-256 for {case_id}")
        expected_pngs.add(f"{case_id}.png")
        screenshot["captureStatus"] = "captured"
        screenshot["sha256"] = digest

    manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    staged_manifest = staged_directory / "manifest.json"
    staged_manifest.write_text(manifest_text, encoding="utf-8")

    actual_pngs = {path.name for path in staged_directory.glob("*.png")}
    if actual_pngs != expected_pngs:
        missing = sorted(expected_pngs - actual_pngs)
        extra = sorted(actual_pngs - expected_pngs)
        raise RuntimeError(f"staged screenshot set is not exact; missing={missing}, extra={extra}")
    if len(actual_pngs) != EXPECTED_CASE_COUNT:
        raise RuntimeError(f"expected exactly {EXPECTED_CASE_COUNT} staged PNGs")

    for fixture_case, width, height in iter_cases(manifest):
        case_id = fixture_case["id"]
        payload = (staged_directory / f"{case_id}.png").read_bytes()
        if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
            raise RuntimeError(f"{case_id}: staged capture is not a PNG")
        staged_width = int.from_bytes(payload[16:20], "big")
        staged_height = int.from_bytes(payload[20:24], "big")
        if (staged_width, staged_height) != (width, height):
            raise RuntimeError(f"{case_id}: staged viewport does not match declaration")
        if hashlib.sha256(payload).hexdigest() != digests[case_id]:
            raise RuntimeError(f"{case_id}: staged digest does not match declaration")

    screenshots_directory = MANIFEST_PATH.parent
    backup_directory = FIXTURE_ROOT / ".screenshots-before-capture"
    if backup_directory.exists():
        raise RuntimeError(f"capture backup already exists: {backup_directory}")
    os.replace(screenshots_directory, backup_directory)
    try:
        os.replace(staged_directory, screenshots_directory)
    except BaseException:
        os.replace(backup_directory, screenshots_directory)
        raise
    shutil.rmtree(backup_directory)


def main() -> int:
    arguments = parse_arguments()
    manifest = load_manifest()
    cases = list(iter_cases(manifest))
    if len(cases) != EXPECTED_CASE_COUNT:
        raise RuntimeError(f"expected {EXPECTED_CASE_COUNT} fixture cases, found {len(cases)}")

    server: subprocess.Popen[bytes] | None = None
    base_url = arguments.base_url
    if base_url is None:
        base_url, server = start_server()
    else:
        base_url = f"{base_url.rstrip('/')}/"
        wait_for_server(base_url, None)

    chrome = discover_chrome(arguments.chrome_executable)
    digests: dict[str, str] = {}
    try:
        with tempfile.TemporaryDirectory(
            prefix=".screenshots-staged-", dir=FIXTURE_ROOT
        ) as temporary:
            staged_directory = Path(temporary)
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    executable_path=chrome,
                    headless=True,
                    args=["--force-color-profile=srgb"],
                )
                try:
                    for index, (fixture_case, width, height) in enumerate(cases, start=1):
                        case_id = fixture_case["id"]
                        last_error: RuntimeError | None = None
                        for attempt in range(1, 3):
                            context = browser.new_context(
                                viewport={"width": width, "height": height},
                                device_scale_factor=1,
                                locale="en-US",
                                color_scheme="light",
                                reduced_motion="reduce",
                            )
                            try:
                                digest = capture_case(
                                    context.new_page(),
                                    base_url,
                                    fixture_case,
                                    width,
                                    height,
                                    staged_directory / f"{case_id}.png",
                                )
                                last_error = None
                                break
                            except RuntimeError as error:
                                last_error = error
                                if attempt == 1:
                                    print(f"[retry] {case_id}: {error}", file=sys.stderr)
                            finally:
                                context.close()
                        if last_error is not None:
                            raise last_error
                        digests[case_id] = digest
                        print(f"[{index:02d}/{len(cases)}] {case_id} {width}x{height} {digest}")
                finally:
                    browser.close()
            persist_captures(manifest, staged_directory, digests)
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)

    aggregate = hashlib.sha256(
        "\n".join(f"{case_id}:{digests[case_id]}" for case_id in sorted(digests)).encode()
    ).hexdigest()
    print(f"Captured {len(digests)} cases; aggregate SHA-256 {aggregate}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError) as error:
        print(f"capture failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error

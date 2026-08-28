#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PopupDecision {
    Deny,
}

#[must_use]
pub(crate) const fn decide_popup() -> PopupDecision {
    PopupDecision::Deny
}

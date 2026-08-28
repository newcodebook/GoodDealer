#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DownloadDecision {
    Deny,
}

#[must_use]
pub(crate) const fn decide_download() -> DownloadDecision {
    DownloadDecision::Deny
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UploadDecision {
    Unavailable,
}

#[must_use]
pub(crate) const fn decide_file_chooser() -> UploadDecision {
    UploadDecision::Unavailable
}

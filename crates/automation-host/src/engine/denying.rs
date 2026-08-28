use super::BrowserEngineError;

pub(super) fn open<T>(_resource: impl FnOnce() -> T) -> Result<T, BrowserEngineError> {
    Err(BrowserEngineError::Unavailable)
}

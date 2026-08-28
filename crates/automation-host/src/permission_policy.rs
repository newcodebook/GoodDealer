#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BrowserPermission {
    Camera,
    Microphone,
    DisplayCapture,
    Geolocation,
    Notifications,
    Midi,
    ClipboardRead,
    ClipboardWrite,
    FileSystemAccess,
    PersistentStorage,
    Sensors,
    Unknown,
}

impl BrowserPermission {
    pub(crate) const ALL: [Self; 12] = [
        Self::Camera,
        Self::Microphone,
        Self::DisplayCapture,
        Self::Geolocation,
        Self::Notifications,
        Self::Midi,
        Self::ClipboardRead,
        Self::ClipboardWrite,
        Self::FileSystemAccess,
        Self::PersistentStorage,
        Self::Sensors,
        Self::Unknown,
    ];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PermissionDecision {
    Deny,
}

#[must_use]
pub(crate) const fn decide_permission(_permission: BrowserPermission) -> PermissionDecision {
    PermissionDecision::Deny
}

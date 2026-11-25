//! Closed SDDL admission for SQLite-created files below the pinned private directory.

pub(super) fn is_private_inherited_file(dacl: &str, user_sid: &str) -> bool {
    // Windows normalizes FILE_ALL_ACCESS to FA. Only the single inherited user ACE is
    // admitted; a NULL DACL, extra principal, object ACE, deny ACE or weaker rights fails.
    dacl == format!("D:AI(A;ID;FA;;;{user_sid})")
}

#[cfg(test)]
mod tests {
    use super::*;
    const USER: &str = "S-1-5-21-111-222-333-1001";
    #[test]
    fn admits_only_exact_inherited_user_access() {
        assert!(is_private_inherited_file(
            &format!("D:AI(A;ID;FA;;;{USER})"),
            USER
        ));
        for dacl in [
            "D:NO_ACCESS_CONTROL".to_owned(),
            "D:AI".to_owned(),
            format!("D:AI(A;ID;FA;;;{USER})(A;ID;FA;;;SY)"),
            format!("D:AI(A;ID;FA;;;{USER})(D;ID;FR;;;WD)"),
            format!("D:AI(A;;FA;;;{USER})"),
            format!("D:AI(A;OICIID;FA;;;{USER})"),
            format!("D:AI(A;ID;FR;;;{USER})"),
            format!("D:AI(D;ID;FA;;;{USER})"),
            format!("D:AI(OA;ID;FA;00000000-0000-0000-0000-000000000000;;{USER})"),
            "D:AI(A;ID;FA;;;S-1-5-21-111-222-333-1002)".to_owned(),
            format!("D:PAI(A;ID;FA;;;{USER})"),
            format!("D:AI(A;ID;FA;;;{USER})garbage"),
        ] {
            assert!(!is_private_inherited_file(&dacl, USER), "accepted {dacl}");
        }
    }
}

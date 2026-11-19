//! Closed protected-object DACL admission; AI records history, ID marks an inherited ACE.

pub(super) fn is_private_protected_acl(dacl: &str, user_sid: &str, directory: bool) -> bool {
    let flags = if directory { "OICI" } else { "" };
    let ace = format!("(A;{flags};FA;;;{user_sid})");
    dacl.strip_prefix("D:P") == Some(ace.as_str())
        || dacl.strip_prefix("D:PAI") == Some(ace.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    const USER: &str = "S-1-5-21-111-222-333-1001";
    #[test]
    fn protected_private_acl_accepts_only_informational_ai_difference() {
        for directory in [false, true] {
            let flags = if directory { "OICI" } else { "" };
            let ace = format!("(A;{flags};FA;;;{USER})");
            for prefix in ["D:P", "D:PAI"] {
                assert!(is_private_protected_acl(
                    &format!("{prefix}{ace}"),
                    USER,
                    directory
                ));
            }
            for prefix in ["D:", "D:AI", "D:PAR", "D:PAIAR", "D:NO_ACCESS_CONTROL"] {
                assert!(!is_private_protected_acl(
                    &format!("{prefix}{ace}"),
                    USER,
                    directory
                ));
            }
            assert!(!is_private_protected_acl(
                &format!("D:P{ace}(A;;FA;;;SY)"),
                USER,
                directory
            ));
            assert!(!is_private_protected_acl(
                &format!("D:P(A;{flags}ID;FA;;;{USER})"),
                USER,
                directory
            ));
            assert!(!is_private_protected_acl(
                &format!("D:P(D;{flags};FA;;;{USER})"),
                USER,
                directory
            ));
            assert!(!is_private_protected_acl(
                &format!("D:P(A;{flags};FR;;;{USER})"),
                USER,
                directory
            ));
            assert!(!is_private_protected_acl(
                &format!("D:P(A;{flags};FA;;;SY)"),
                USER,
                directory
            ));
        }
    }
}

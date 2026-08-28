#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unavailable {
    Unavailable,
}

#[must_use]
pub const fn unavailable(_input: &[u8]) -> Unavailable {
    Unavailable::Unavailable
}

#[cfg(test)]
mod tests {
    use super::{Unavailable, unavailable};

    #[test]
    fn all_bytes_are_unavailable() {
        let valid_form = br#"{"kind":"opaque","value":"valid-form"}"#;
        let malformed = b"\xff\xfe{";
        let oversized = vec![0_u8; 1_048_577];
        let inputs: [&[u8]; 3] = [valid_form, malformed, &oversized];

        for input in inputs {
            assert_eq!(unavailable(input), Unavailable::Unavailable);
        }
    }
}

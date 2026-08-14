use serde::{Deserialize, Deserializer};

pub(crate) const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_JAVASCRIPT_SAFE_NUMBER: f64 = 9_007_199_254_740_991.0;

#[derive(Debug, Clone, Copy)]
pub(crate) struct SafeUnsignedInteger(u64);

impl SafeUnsignedInteger {
    pub(crate) const fn get(self) -> u64 {
        self.0
    }
}

impl<'de> Deserialize<'de> for SafeUnsignedInteger {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let number = serde_json::Number::deserialize(deserializer)?;
        let value = if let Some(value) = number.as_u64() {
            value
        } else {
            let value = number
                .as_f64()
                .filter(|value| {
                    value.is_finite()
                        && *value >= 0.0
                        && value.fract() == 0.0
                        && *value <= MAX_JAVASCRIPT_SAFE_NUMBER
                })
                .ok_or_else(|| {
                    serde::de::Error::custom("expected a JavaScript-safe unsigned integer")
                })?;
            if value == 0.0 {
                0
            } else {
                format!("{value:.0}").parse::<u64>().map_err(|_| {
                    serde::de::Error::custom("expected a JavaScript-safe unsigned integer")
                })?
            }
        };
        if value > MAX_JAVASCRIPT_SAFE_INTEGER {
            return Err(serde::de::Error::custom(
                "expected a JavaScript-safe unsigned integer",
            ));
        }
        Ok(Self(value))
    }
}

pub(crate) fn deserialize_required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

pub(crate) fn is_identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 160 && value.bytes().all(|byte| byte.is_ascii_graphic())
}

pub(crate) fn is_base64_url(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(crate) fn is_canonical_utc_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
    {
        return false;
    }
    let digits = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];
    if digits
        .into_iter()
        .any(|index| !bytes[index].is_ascii_digit())
    {
        return false;
    }
    let number = |start: usize, length: usize| -> u32 {
        bytes[start..start + length]
            .iter()
            .fold(0, |value, byte| value * 10 + u32::from(*byte - b'0'))
    };
    let year = number(0, 4);
    let month = number(5, 2);
    let day = number(8, 2);
    let hour = number(11, 2);
    let minute = number(14, 2);
    let second = number(17, 2);
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days_in_month).contains(&day) && hour <= 23 && minute <= 59 && second <= 59
}

pub(crate) fn canonical_utc_seconds(value: &str) -> Option<i64> {
    if !is_canonical_utc_timestamp(value) {
        return None;
    }
    let bytes = value.as_bytes();
    let number = |start: usize, length: usize| -> i64 {
        bytes[start..start + length]
            .iter()
            .fold(0, |result, byte| result * 10 + i64::from(*byte - b'0'))
    };
    let year = number(0, 4);
    let month = number(5, 2);
    let day = number(8, 2);
    let hour = number(11, 2);
    let minute = number(14, 2);
    let second = number(17, 2);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_offsets = [0_i64, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let days_before_year = 365 * year + (year + 3) / 4 - (year + 99) / 100 + (year + 399) / 400;
    let leap_day = i64::from(leap && month > 2);
    let month_index = usize::try_from(month - 1).ok()?;
    let days = days_before_year + *month_offsets.get(month_index)? + leap_day + day - 1;
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second)
}

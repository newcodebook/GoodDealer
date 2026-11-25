import { z } from "zod";

/** Maximum connection label length in UTF-16 code units, matching the Host's write and read rule. */
export const connectionLabelMaxLength = 120;

/**
 * A Provider connection label as every Host read reports it. The Host applies the same rule when
 * the label is written, so a stored label never fails a later read on either side.
 */
export const connectionLabelSchema = z.string().min(1)
  // `String#length` is the UTF-16 unit count; checked directly so the unit cannot drift from the Host.
  .refine((value) => value.length <= connectionLabelMaxLength, `at most ${connectionLabelMaxLength} UTF-16 units`)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "connection labels reject control and format characters");

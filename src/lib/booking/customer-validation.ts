import { z } from "zod";
import {
  INVALID_PHONE_MESSAGE,
  isValidNormalizedPhoneNumber,
} from "@/lib/normalize-phone";

const UNSAFE_NAME_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

/** Validates names without transforming them; successful values are stored as typed. */
export const customerNameSchema = z
  .string()
  .refine((value) => {
    const characterCount = Array.from(value).length;
    return characterCount >= 1 && characterCount <= 120;
  })
  .refine((value) => value.trim().length > 0)
  .refine((value) => !UNSAFE_NAME_CHARACTERS.test(value));

/** The server normalizes a submitted number before applying this schema. */
export const normalizedCustomerPhoneSchema = z
  .string()
  .refine(isValidNormalizedPhoneNumber, INVALID_PHONE_MESSAGE);

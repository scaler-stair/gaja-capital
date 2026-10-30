import bcrypt from "bcryptjs";
import { randomInt } from "crypto";

const ROUNDS = 11;
export const MIN_PASSWORD_LENGTH = 10;

/** Letters and digits that cannot be confused when read aloud or copied by hand. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** A hash of a random string, compared against when the email is unknown so timing gives nothing away. */
export const DECOY_HASH = bcrypt.hashSync(String(Math.random()), ROUNDS);

/**
 * Temporary password for a new or reset account, grouped for readability: e.g. "Kp7w-Rt3m-Qx9a".
 * Always contains letters and digits, so it passes passwordProblem().
 */
export function generatePassword(): string {
  for (;;) {
    const groups: string[] = [];
    for (let g = 0; g < 3; g++) {
      let group = "";
      for (let i = 0; i < 4; i++) group += ALPHABET[randomInt(ALPHABET.length)];
      groups.push(group);
    }
    const password = groups.join("-");
    if (/[A-Za-z]/.test(password) && /[0-9]/.test(password)) return password;
  }
}

/** Null when acceptable, otherwise the reason it is not. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 200) return "Password is too long";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain both letters and numbers";
  }
  return null;
}

/** People sign in with their email address, stored lowercased. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function emailProblem(email: string): string | null {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) {
    return "Enter a valid email address, for example name@gajacapital.com";
  }
  return null;
}

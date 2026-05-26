import crypto from 'crypto';

// 세션 서명 및 암호화에 사용할 비밀키 (실제 Vercel 배포 시에는 환경변수로 임의 키 등록 권장)
const SESSION_SECRET = process.env.SESSION_SECRET || 'premium_naver_dashboard_v2_secure_secret_key_32bytes_value';
const ALGORITHM = 'aes-256-cbc';
const KEY = crypto.scryptSync(SESSION_SECRET, 'salt_value_for_dashboard', 32);

/**
 * 비밀번호를 PBKDF2 알고리즘으로 단방향 해시화합니다.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * 입력된 비밀번호와 DB에 해시 저장된 비밀번호를 검증합니다.
 */
export function verifyPassword(password: string, storedValue: string): boolean {
  try {
    const [salt, hash] = storedValue.split(':');
    if (!salt || !hash) return false;
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  } catch (err) {
    return false;
  }
}

/**
 * 사용자 정보 세션을 AES-256-CBC로 안전하게 양방향 암호화 토큰화합니다.
 */
export function encryptSession(data: { userId: string; userName: string; role: string }): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * 암호화된 세션 토큰을 복호화하여 복구합니다. 실패 시 null을 반환합니다.
 */
export function decryptSession(token: string): { userId: string; userName: string; role: string } | null {
  try {
    const [ivHex, encryptedHex] = token.split(':');
    if (!ivHex || !encryptedHex) return null;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (err) {
    return null;
  }
}

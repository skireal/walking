const ERROR_MAP: Record<string, string> = {
  'auth/invalid-email':           'Invalid email address.',
  'auth/invalid-credential':      'Incorrect email or password.',
  'auth/wrong-password':          'Incorrect password.',
  'auth/user-not-found':          'No account found with this email.',
  'auth/email-already-in-use':    'An account with this email already exists.',
  'auth/weak-password':           'Password must be at least 6 characters.',
  'auth/too-many-requests':       'Too many attempts. Please try again later.',
  'auth/network-request-failed':  'Network error. Check your connection.',
  'auth/popup-closed-by-user':    'Sign-in was cancelled.',
  'auth/cancelled-popup-request': 'Sign-in was cancelled.',
  'auth/user-disabled':           'This account has been disabled.',
};

export function parseFirebaseError(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) {
    const code = (e as { code: string }).code;
    return ERROR_MAP[code] ?? 'Something went wrong. Please try again.';
  }
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Please try again.';
}

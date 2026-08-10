import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

const BRAND_GREEN = '#0A5C36';

function pageShell(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ryda</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F7F7F7; margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #fff; border-radius: 16px; padding: 32px 28px; max-width: 380px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.06); text-align: center; }
  h1 { font-size: 20px; color: #1A1A1A; margin: 0 0 8px; }
  p { font-size: 14px; color: #666; line-height: 1.5; margin: 0 0 20px; }
  .icon { width: 56px; height: 56px; border-radius: 28px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 26px; }
  .icon-success { background: ${BRAND_GREEN}; color: #fff; }
  .icon-error { background: #FDECEA; color: #C0392B; }
  .icon-loading { background: #F0F0F0; color: #999; }
  input { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #E0E0E0; border-radius: 10px; font-size: 15px; margin-bottom: 12px; }
  button { width: 100%; padding: 13px; border: none; border-radius: 10px; background: ${BRAND_GREEN}; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:disabled { background: #CFE3D8; cursor: not-allowed; }
  .error-text { color: #C0392B; font-size: 13px; margin-top: 8px; }
</style>
</head>
<body>
<div class="card">${bodyHtml}</div>
</body>
</html>`;
}

@Controller()
export class PagesController {
  @Get('verify-email')
  verifyEmail(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/html');
    res.send(
      pageShell(`
        <div id="state">
          <div class="icon icon-loading">⏳</div>
          <h1>Verifying your email…</h1>
          <p>This will just take a moment.</p>
        </div>
        <script>
          const params = new URLSearchParams(window.location.search);
          const token = params.get('token');
          const state = document.getElementById('state');

          if (!token) {
            state.innerHTML = '<div class="icon icon-error">✕</div><h1>Missing verification link</h1><p>This link looks incomplete. Please use the exact link from your email.</p>';
          } else {
            fetch('/api/v1/auth/verify-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token }),
            })
              .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
              .then(({ ok, body }) => {
                if (ok) {
                  state.innerHTML = '<div class="icon icon-success">✓</div><h1>Email verified</h1><p>Your account is active. You can now return to the Ryda app and log in.</p>';
                } else {
                  state.innerHTML = '<div class="icon icon-error">✕</div><h1>Verification failed</h1><p>' + (body.message || 'This link is invalid or has expired.') + '</p>';
                }
              })
              .catch(() => {
                state.innerHTML = '<div class="icon icon-error">✕</div><h1>Something went wrong</h1><p>Please try again in a moment, or request a new verification email from the app.</p>';
              });
          }
        </script>
      `),
    );
  }

  @Get('reset-password')
  resetPassword(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/html');
    res.send(
      pageShell(`
        <div id="form-state">
          <div class="icon icon-loading">🔒</div>
          <h1>Reset your password</h1>
          <p>Choose a new password for your Ryda account.</p>
          <input type="password" id="newPassword" placeholder="New password" minlength="8" />
          <input type="password" id="confirmPassword" placeholder="Confirm new password" minlength="8" />
          <button id="submitBtn" onclick="submitReset()">Reset password</button>
          <div id="errorText" class="error-text"></div>
        </div>
        <script>
          const params = new URLSearchParams(window.location.search);
          const token = params.get('token');

          function submitReset() {
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const errorText = document.getElementById('errorText');
            errorText.textContent = '';

            if (!token) {
              errorText.textContent = 'This link looks incomplete. Please use the exact link from your email.';
              return;
            }
            if (newPassword.length < 8) {
              errorText.textContent = 'Password must be at least 8 characters.';
              return;
            }
            if (newPassword !== confirmPassword) {
              errorText.textContent = "Passwords don't match.";
              return;
            }

            const btn = document.getElementById('submitBtn');
            btn.disabled = true;
            btn.textContent = 'Resetting…';

            fetch('/api/v1/auth/reset-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, newPassword }),
            })
              .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
              .then(({ ok, body }) => {
                if (ok) {
                  document.getElementById('form-state').innerHTML = '<div class="icon icon-success">✓</div><h1>Password reset</h1><p>You can now return to the Ryda app and log in with your new password.</p>';
                } else {
                  btn.disabled = false;
                  btn.textContent = 'Reset password';
                  errorText.textContent = body.message || 'This link is invalid or has expired.';
                }
              })
              .catch(() => {
                btn.disabled = false;
                btn.textContent = 'Reset password';
                errorText.textContent = 'Something went wrong. Please try again.';
              });
          }
        </script>
      `),
    );
  }
}

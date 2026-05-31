// worker/src/routes/auth.js
import { signJWT, verifyJWT } from '../utils/jwt.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, created, error, unauthorized, serverError } from '../utils/response.js';

// ── UTILITY HELPERS ──────────────────────────────────────────────────────────
async function getSetting(env, key, fallback = '') {
    try {
        const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
        return row ? row.value : fallback;
    } catch {
        return fallback;
    }
}

function nowIso(plusMinutes = 0) {
    const d = new Date();
    if (plusMinutes) d.setMinutes(d.getMinutes() + plusMinutes);
    return d.toISOString();
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function masked(email) {
    if (!email) return '';
    const [name, domain] = email.split('@');
    if (!domain) return email;
    if (name.length <= 2) return `${name[0]}*@${domain}`;
    return `${name[0]}${'*'.repeat(name.length - 2)}${name[name.length - 1]}@${domain}`;
}

function mapUser(u) {
    if (!u) return null;
    const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
    return {
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name || '',
        name: fullName,
        email: u.email,
        phone: u.phone || '',
        role: u.role,
        emailVerified: !!u.email_verified,
        isBlocked: !!u.is_blocked,
        lastLoginAt: u.last_login_at,
        createdAt: u.created_at
    };
}

// ── OTP EMAIL HELPERS ─────────────────────────────────────────────────────────
async function sendOtpEmail(env, email, otp, purpose) {
    let resendApiKey = await getSetting(env, 'resend_api_key', '');
    if (!resendApiKey && env.RESEND_API_KEY) {
        resendApiKey = env.RESEND_API_KEY;
    }

    if (!resendApiKey) {
        return { ok: false, error: 'Resend API key not configured. Add resend_api_key to settings.' };
    }

    const siteName = await getSetting(env, 'site_name', 'HeelsUp');
    const fromAddress = await getSetting(env, 'email_from_address', 'support@heelsup.in');

    const subjects = {
        register: `Verify your ${siteName} account`,
        forgot: `Reset your ${siteName} password`,
        login: `Your ${siteName} login OTP`
    };

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resendApiKey}`
            },
            body: JSON.stringify({
                from: `${siteName} <${fromAddress}>`,
                to: [email],
                subject: subjects[purpose] || `Your ${siteName} OTP`,
                html: buildOtpHtml(siteName, otp, purpose)
            })
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            console.error('Resend API Error:', errorData);
            return { ok: false, error: errorData.message || 'Failed to send email via Resend' };
        }

        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function buildOtpHtml(siteName, otp, purpose, userName = 'Customer') {
    let bodyText = '';
    if (purpose === 'forgot') {
        bodyText = `We received a request to reset your password.<br><br>
Use the following OTP to reset your password:<br><br>
🔢 <strong>${otp}</strong><br><br>
⏱️ Valid for <strong>10 minutes</strong> only.<br><br>
Do not share this OTP with anyone.<br>
If you didn't request this, please secure your account immediately.`;
    } else {
        bodyText = `Your One-Time Password (OTP) is:<br><br>
🔢 <strong>${otp}</strong><br><br>
⏱️ This OTP is valid for <strong>10 minutes</strong>.<br><br>
⚠️ Do not share this code with anyone for security reasons.<br>
If you did not request this, please ignore this email.`;
    }

    return `<!DOCTYPE html><html><body style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #000;">
Dear ${userName},<br><br>
${bodyText}<br><br>
Thanks,<br>
Team Heelsup<br>
support@heelsup.in<br>
https://heelsup.in
</body></html>`;
}

async function verifyOtp(env, email, otp, purpose) {
    const otpPlain = String(otp).trim();
    const token = await env.DB.prepare(
        'SELECT * FROM otp_tokens WHERE email=? AND purpose=? AND verified IN (0, 1) AND expires_at>? ORDER BY id DESC LIMIT 1'
    ).bind(email, purpose, nowIso()).first();

    if (!token) return { ok: false, error: 'OTP expired or not found. Request a new OTP.' };
    if ((token.attempts || 0) >= 5) return { ok: false, error: 'Too many incorrect attempts. Request a new OTP.' };

    if (token.otp_hash !== otpPlain) {
        await env.DB.prepare('UPDATE otp_tokens SET attempts=attempts+1 WHERE id=?').bind(token.id).run();
        const rem = 5 - ((token.attempts || 0) + 1);
        return { ok: false, error: `Incorrect OTP. ${rem} attempts remaining.` };
    }

    await env.DB.prepare('UPDATE otp_tokens SET verified=1 WHERE id=?').bind(token.id).run();
    return { ok: true };
}

// ── MAIN ROUTER ──────────────────────────────────────────────────────────────
export async function authRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/auth', '');
    const method = request.method;

    // POST /api/auth/send-otp
    if (path === '/send-otp' && method === 'POST') {
        try {
            const body = await request.json();
            if (!body) return error('Invalid JSON', 400);
            const email = normalizeEmail(body.email);
            const purpose = String(body.purpose || 'register');

            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return error('Valid email is required', 400);
            }
            if (!['register', 'forgot', 'login'].includes(purpose)) {
                return error('Invalid purpose', 400);
            }

            const hourAgo = new Date(Date.now() - 3600000).toISOString();
            const recent = await env.DB.prepare(
                'SELECT COUNT(*) as c FROM otp_tokens WHERE email=? AND purpose=? AND created_at>?'
            ).bind(email, purpose, hourAgo).first();
            if ((recent?.c || 0) >= 5) return error('Too many OTP requests. Wait 1 hour.', 429);

            const otp = String(Math.floor(100000 + Math.random() * 900000));
            const expiresAt = nowIso(parseInt(await getSetting(env, 'otp_expiry_minutes', '10')));

            await env.DB.prepare(
                'INSERT INTO otp_tokens (email, otp_hash, purpose, attempts, verified, expires_at, created_at) VALUES (?,?,?,0,0,?,?)'
            ).bind(email, otp, purpose, expiresAt, nowIso()).run();

            const emailResult = await sendOtpEmail(env, email, otp, purpose);
            if (!emailResult.ok) return error(emailResult.error || 'Failed to send OTP. Please try again.', 502);

            return ok({ email }, `OTP sent to ${email}`);
        } catch (e) {
            console.error('Send OTP error:', e);
            return serverError('Failed to send OTP');
        }
    }

    // POST /api/auth/verify-otp
    if (path === '/verify-otp' && method === 'POST') {
        try {
            const body = await request.json();
            if (!body) return error('Invalid JSON', 400);
            const email = normalizeEmail(body.email);
            const otp = String(body.otp || '').trim();
            const purpose = String(body.purpose || 'register');

            if (!email || !otp) return error('Email and OTP required', 400);

            const otpResult = await verifyOtp(env, email, otp, purpose);
            if (!otpResult.ok) return error(otpResult.error, 400);

            return ok({ verified: true }, 'OTP verified successfully');
        } catch (e) {
            console.error('Verify OTP error:', e);
            return serverError('Failed to verify OTP');
        }
    }

    // POST /api/auth/register
    if (path === '/register' && method === 'POST') {
        try {
            const body = await request.json();
            if (!body) return error('Invalid JSON', 400);
            const firstName = String(body.firstName || body.first_name || '').trim();
            const lastName = String(body.lastName || body.last_name || '').trim();
            const email = normalizeEmail(body.email);
            const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
            const password = String(body.password || '');
            const otp = String(body.otp || '').trim();

            if (!firstName || !email || !password) return error('First Name, email and password are required');
            if (password.length < 8) return error('Password must be at least 8 characters');

            const requireOtp = await getSetting(env, 'require_email_otp', 'true');
            if (requireOtp !== 'false') {
                const otpResult = await verifyOtp(env, email, otp, 'register');
                if (!otpResult.ok) return error(otpResult.error, 400);
            }

            // Check if email exists
            const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
            if (existing) return error('An account with this email already exists', 409);

            const hashed = await hashPassword(password);
            const now = nowIso();
            const result = await env.DB.prepare(
                'INSERT INTO users (first_name, last_name, email, phone, password_hash, role, email_verified, staff_permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \'customer\', 1, \'[]\', ?, ?)'
            ).bind(firstName, lastName, email, phone || null, hashed, now, now).run();

            const userId = result.meta?.last_row_id;
            const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
            const mapped = mapUser(user);

            const token = await signJWT({ id: mapped.id, email: mapped.email, role: mapped.role, name: mapped.name }, env.JWT_SECRET);
            return created({ token, user: mapped }, 'Registration successful');
        } catch (e) {
            console.error('Register error:', e);
            return serverError('Registration failed');
        }
    }

    // POST /api/auth/login
    if (path === '/login' && method === 'POST') {
        try {
            const body = await request.json();
            if (!body) return error('Invalid JSON', 400);
            const email = normalizeEmail(body.email);
            const password = String(body.password || '');

            if (!email || !password) return error('Email and password required');

            // Rate limit check (per IP)
            const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
            const rateLimitKey = `ratelimit:login:${ip}`;
            const attempts = parseInt(await env.KV.get(rateLimitKey) || '0');
            if (attempts >= 5) return error('Too many login attempts. Try after 1 minute.', 429);

            const user = await env.DB.prepare(
                'SELECT * FROM users WHERE email = ?'
            ).bind(email).first();

            if (!user || !(await verifyPassword(password, user.password_hash))) {
                await env.KV.put(rateLimitKey, String(attempts + 1), { expirationTtl: 60 });
                return unauthorized('Invalid email or password');
            }

            if (user.is_blocked) return unauthorized('Your account has been suspended. Contact support.');

            // Reset rate limit on success
            await env.KV.delete(rateLimitKey);

            const mapped = mapUser(user);
            const isAdminUser = ['admin', 'staff', 'manager'].includes(mapped.role);

            // ── Admin 2FA: OTP step ───────────────────────────────────────────
            // Only triggered for admin/staff/manager when REQUIRE_EMAIL_OTP = "true"
            const requireOtp = (env.REQUIRE_EMAIL_OTP === 'true') ||
                               (await getSetting(env, 'require_email_otp', 'false') === 'true');

            if (isAdminUser && requireOtp) {
                // Issue short-lived session token (5 min) — cannot access admin routes
                const sessionToken = await signJWT(
                    { id: mapped.id, email: mapped.email, role: mapped.role, name: mapped.name, otp_pending: true },
                    env.JWT_SECRET,
                    5  // 5 minute expiry
                );

                // Generate & store OTP in KV (10 min TTL)
                const otp = String(Math.floor(100000 + Math.random() * 900000));
                const otpKey = `otp:admin_login:${email}`;

                // Rate limit OTP resends: max 3 per hour
                const resendKey = `otp_resend:admin_login:${email}`;
                const resendCount = parseInt(await env.KV.get(resendKey) || '0');
                if (resendCount >= 3) {
                    return error('Too many OTP requests. Wait 1 hour.', 429);
                }

                await env.KV.put(otpKey, JSON.stringify({
                    otp,
                    attempts: 0,
                    created_at: Date.now()
                }), { expirationTtl: 600 }); // 10 min

                await env.KV.put(resendKey, String(resendCount + 1), { expirationTtl: 3600 }); // 1 hour

                // ALWAYS print to console for development/debugging ease
                console.log(`[ADMIN 2FA] Generated OTP for ${email}: ${otp}`);

                // Send OTP email via Resend
                const emailResult = await sendOtpEmail(env, email, otp, 'login');
                if (!emailResult.ok) {
                    console.error('Failed to send admin OTP:', emailResult.error);
                    if (env.REQUIRE_EMAIL_OTP === 'true') {
                        return ok({
                            step: 'otp_required',
                            session_token: sessionToken,
                            email: mapped.email,
                            warning: 'OTP email delivery failed, check worker console/logs'
                        }, `OTP generated (email delivery failed: ${emailResult.error || 'unknown error'})`);
                    }
                    // Otherwise (if requireOtp came from DB settings and env is false), we can fall through.
                    console.warn('OTP email failed — falling through to direct login for:', email);
                } else {
                    // OTP sent successfully — require 2FA step
                    return ok({
                        step: 'otp_required',
                        session_token: sessionToken,
                        email: mapped.email,
                    }, `OTP sent to ${masked(email)}`);
                }
            }

            // ── Normal login (customer) or admin fallback if OTP email failed ──
            const now = nowIso();
            await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id).run();
            user.last_login_at = now;

            const token = await signJWT(
                { id: mapped.id, email: mapped.email, role: mapped.role, name: mapped.name },
                env.JWT_SECRET
            );
            return ok({ token, user: mapped }, 'Login successful');
        } catch (e) {
            console.error('Login error:', e);
            return serverError('Login failed');
        }
    }

    // POST /api/auth/admin-verify-otp  — Step 2 of admin 2FA login
    // Verifies OTP from KV, issues real full-duration JWT
    if (path === '/admin-verify-otp' && method === 'POST') {
        try {
            const body = await request.json();
            if (!body) return error('Invalid JSON', 400);
            const inputOtp = String(body.otp || '').trim();
            if (!inputOtp || inputOtp.length !== 6) return error('6-digit OTP required', 400);

            // Must have session_token from step 1
            const authHeader = request.headers.get('Authorization') || '';
            const sessionToken = body.session_token || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);
            if (!sessionToken) return error('session_token required', 400);

            // Verify the short-lived JWT
            const payload = await verifyJWT(sessionToken, env.JWT_SECRET);
            if (!payload) return unauthorized('Session expired. Please login again.');
            if (!payload.otp_pending) return error('Invalid session type', 400);

            const email = payload.email;
            const otpKey = `otp:admin_login:${email}`;
            const raw = await env.KV.get(otpKey);
            if (!raw) return error('OTP expired or not found. Please login again.', 400);

            const otpData = JSON.parse(raw);

            // Lock after 5 wrong attempts
            if (otpData.attempts >= 5) {
                await env.KV.delete(otpKey);
                return error('Too many incorrect attempts. Please login again.', 429);
            }

            if (otpData.otp !== inputOtp) {
                otpData.attempts++;
                await env.KV.put(otpKey, JSON.stringify(otpData), { expirationTtl: 600 });
                const remaining = 5 - otpData.attempts;
                return error(`Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`, 400);
            }

            // ✅ OTP correct — clean up and issue real JWT
            await env.KV.delete(otpKey);
            await env.KV.delete(`otp_resend:admin_login:${email}`);

            const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
            if (!user || user.is_blocked) return unauthorized('Account not accessible.');

            const now = nowIso();
            await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id).run();

            const mapped = mapUser(user);
            const token = await signJWT(
                { id: mapped.id, email: mapped.email, role: mapped.role, name: mapped.name },
                env.JWT_SECRET
            );

            // Log successful admin login to activity_log if table exists
            try {
                await env.DB.prepare(
                    "INSERT OR IGNORE INTO activity_log (admin_id, action, entity, details, created_at) VALUES (?, 'login', 'auth', '2FA login successful', ?)"
                ).bind(mapped.id, now).run();
            } catch (_) { /* activity_log may not exist */ }

            return ok({ token, user: mapped }, 'Login successful');
        } catch (e) {
            console.error('Admin verify OTP error:', e);
            return serverError('OTP verification failed');
        }
    }


    // GET /api/auth/me
    if (path === '/me' && method === 'GET') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;

        const dbUser = await env.DB.prepare(
            'SELECT * FROM users WHERE id = ?'
        ).bind(user.id).first();

        if (!dbUser) return unauthorized('User not found');
        return ok({ user: mapUser(dbUser) });
    }

    // POST /api/auth/logout
    if (path === '/logout' && method === 'POST') {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (token) {
            await env.KV.put(`blacklist:${token}`, '1', { expirationTtl: 86400 * 7 });
        }
        return ok(null, 'Logged out successfully');
    }

    // POST /api/auth/forgot-password
    if (path === '/forgot-password' && method === 'POST') {
        try {
            const body = await request.json();
            const email = normalizeEmail(body?.email);
            if (!email) return error('Email is required', 400);

            const user = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
            if (!user) return ok({ email }, 'If this email exists, an OTP has been sent.');

            const hourAgo = new Date(Date.now() - 3600000).toISOString();
            const recent = await env.DB.prepare(
                'SELECT COUNT(*) as c FROM otp_tokens WHERE email=? AND purpose=\'forgot\' AND created_at>?'
            ).bind(email, hourAgo).first();
            if ((recent?.c || 0) >= 3) return ok({ email }, 'If this email exists, an OTP has been sent.');

            const otp = String(Math.floor(100000 + Math.random() * 900000));
            const expiresAt = nowIso(parseInt(await getSetting(env, 'otp_expiry_minutes', '10')));

            await env.DB.prepare(
                'INSERT INTO otp_tokens (email,otp_hash,purpose,attempts,verified,expires_at,created_at) VALUES (?,?,\'forgot\',0,0,?,?)'
            ).bind(email, otp, expiresAt, nowIso()).run();

            await sendOtpEmail(env, email, otp, 'forgot');
            return ok({ email }, 'If this email exists, an OTP has been sent.');
        } catch (e) {
            console.error('Forgot password error:', e);
            return serverError('Failed to process forgot password');
        }
    }

    // POST /api/auth/reset-password
    if (path === '/reset-password' && method === 'POST') {
        try {
            const body = await request.json();
            const email = normalizeEmail(body?.email);
            const otp = String(body?.otp || '').trim();
            const password = String(body?.password || '');

            if (!email || !otp || !password) return error('email, otp, and password are required', 400);
            if (password.length < 8) return error('Password must be at least 8 characters', 400);

            const otpResult = await verifyOtp(env, email, otp, 'forgot');
            if (!otpResult.ok) return error(otpResult.error, 400);

            const hash = await hashPassword(password);
            await env.DB.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE email=?').bind(hash, nowIso(), email).run();

            const user = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
            if (user) {
                // Revoke active sessions
                await env.DB.prepare('UPDATE sessions SET revoked=1 WHERE user_id=?').bind(user.id).run();
            }

            await env.DB.prepare('DELETE FROM otp_tokens WHERE email=? AND purpose=\'forgot\'').bind(email).run();
            return ok(null, 'Password reset successful. Please log in.');
        } catch (e) {
            console.error('Reset password error:', e);
            return serverError('Failed to reset password');
        }
    }

    // POST /api/auth/google
    if (path === '/google' && method === 'POST') {
        try {
            const body = await request.json();
            const credential = body?.credential;
            if (!credential) return error('Missing Google credential', 400);

            const clientId = await getSetting(env, 'google_client_id', '');
            if (!clientId) return error('Google Login is not configured on the server.', 500);

            // Verify Google token
            const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
            if (!res.ok) return error('Invalid Google token', 401);
            const data = await res.json();

            if (data.aud !== clientId) {
                return error('Invalid Client ID mismatch', 401);
            }

            if (data.email_verified !== 'true' && data.email_verified !== true) {
                return error('Google email is not verified', 401);
            }

            const email = normalizeEmail(data.email);
            let user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();

            const now = nowIso();
            if (!user) {
                // Create a new user with random password
                const randPw = Math.random().toString(36) + Math.random().toString(36);
                const hash = await hashPassword(randPw);
                const fname = data.given_name || data.name || 'Google User';
                const lname = data.family_name || '';

                const result = await env.DB.prepare(
                    "INSERT INTO users (first_name, last_name, email, password_hash, role, email_verified, staff_permissions, created_at, updated_at) VALUES (?, ?, ?, ?, 'customer', 1, '[]', ?, ?)"
                ).bind(fname, lname, email, hash, now, now).run();

                const userId = result.meta?.last_row_id;
                user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
            } else if (!user.email_verified) {
                await env.DB.prepare('UPDATE users SET email_verified=1, updated_at=? WHERE id=?').bind(now, user.id).run();
                user.email_verified = 1;
            }

            if (user.is_blocked) return error('Your account has been suspended. Contact support.', 403);

            // Update last login
            await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now, user.id).run();
            user.last_login_at = now;

            const mapped = mapUser(user);
            const token = await signJWT(
                { id: mapped.id, email: mapped.email, role: mapped.role, name: mapped.name },
                env.JWT_SECRET
            );

            return ok({ token, user: mapped }, 'Login successful');
        } catch (e) {
            console.error('Google authentication error:', e);
            return serverError('Google authentication failed');
        }
    }

    // POST /api/auth/admin-setup
    if (path === '/admin-setup' && method === 'POST') {
        try {
            const { name, email, password, secret } = await request.json();
            if (secret !== env.ADMIN_SECRET) return unauthorized('Invalid secret');

            const existing = await env.DB.prepare('SELECT id FROM users WHERE role = \'admin\' LIMIT 1').first();
            if (existing) return error('Admin already exists', 409);

            const hashed = await hashPassword(password);
            const now = nowIso();
            const result = await env.DB.prepare(
                'INSERT INTO users (first_name, last_name, email, password_hash, role, email_verified, staff_permissions, created_at, updated_at) VALUES (?, \'\', ?, ?, \'admin\', 1, \'[]\', ?, ?)'
            ).bind(name, email.toLowerCase().trim(), hashed, now, now).run();

            const userId = result.meta?.last_row_id;
            const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
            const mapped = mapUser(user);

            const token = await signJWT({ id: mapped.id, email: mapped.email, role: mapped.role, name: mapped.name }, env.JWT_SECRET);
            return created({ token, user: mapped }, 'Admin created');
        } catch (e) {
            console.error('Admin setup error:', e);
            return serverError('Admin setup failed');
        }
    }

    // PUT /api/auth/profile
    if (path === '/profile' && method === 'PUT') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        try {
            const body = await request.json();
            const firstName = String(body.firstName || body.first_name || '').trim();
            const lastName = String(body.lastName || body.last_name || '').trim();
            const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);

            if (!firstName) return error('First Name is required');

            await env.DB.prepare(
                'UPDATE users SET first_name = ?, last_name = ?, phone = ?, updated_at = ? WHERE id = ?'
            ).bind(firstName, lastName, phone, nowIso(), user.id).run();

            const updatedUser = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
            return ok({ user: mapUser(updatedUser) }, 'Profile updated successfully');
        } catch (e) {
            console.error('Profile update error:', e);
            return serverError('Profile update failed');
        }
    }

    // PUT /api/auth/change-password
    if (path === '/change-password' && method === 'PUT') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        try {
            const body = await request.json();
            const current = String(body.currentPassword || body.current_password || '');
            const newPass = String(body.newPassword || body.new_password || '');

            if (!current || !newPass) return error('Current and new passwords are required');
            if (newPass.length < 8) return error('New password must be at least 8 characters');

            const dbUser = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
            if (!dbUser || !(await verifyPassword(current, dbUser.password_hash))) {
                return error('Current password is incorrect');
            }

            const hash = await hashPassword(newPass);
            await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(hash, nowIso(), user.id).run();

            return ok(null, 'Password changed successfully');
        } catch (e) {
            console.error('Change password error:', e);
            return serverError('Failed to change password');
        }
    }

    return error('Route not found', 404);
}
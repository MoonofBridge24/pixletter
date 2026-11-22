# Google OAuth Setup Guide

## 1. Create a Project in Google Cloud Console

- Go to https://console.cloud.google.com
- Create a new project or select an existing one

## 2. Configure OAuth Consent Screen

- APIs & Services → OAuth consent screen
- User Type: **External**
- App name: `pixletter`
- User support email: your email address
- Authorized domains: your Pages domain (e.g., `pixletter.pages.dev`)
- Scopes: `email`, `profile`, `openid`
- Test users: add your Gmail address (only test users can sign in before verification)

## 3. Create OAuth Client ID

- APIs & Services → Credentials → Create Credentials → OAuth Client ID
- Application type: **Web application**
- Name: `pixletter`
- Authorized JavaScript origins: `https://<your-dashboard>.pages.dev`
- Authorized redirect URIs: `https://<your-dashboard>.pages.dev/api/auth/callback/google`

## 4. Set Secrets on the Pages Project

```bash
echo "<YOUR_CLIENT_ID>" | npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name=pixletter
echo "<YOUR_CLIENT_SECRET>" | npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name=pixletter

pnpm --filter @pixletter/dashboard build
cd apps/dashboard && npx wrangler pages deploy dist --branch=main
```

## 5. Verify

Open in browser:
```
https://<your-dashboard>.pages.dev/api/auth/sign-in/social?provider=google
```
→ If you are redirected to the Google login screen, the setup is complete.

## Notes

- Before verification, the app is in "Testing" status. Only test users added in the consent screen can sign in (max 100 users).
- Full production access requires Google's verification review (days to weeks).
- Email/password authentication works without Google verification.

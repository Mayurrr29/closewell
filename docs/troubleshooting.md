# Troubleshooting

| Symptom | Cause and fix |
|---|---|
| API exits with "Could not connect to MongoDB" | Start MongoDB or fix `MONGODB_URI`. Atlas: check the IP allow-list and user password. |
| API refuses to start in production | `JWT_ACCESS_SECRET` or `ENCRYPTION_KEY` missing; generate with `openssl rand -hex 32` and `openssl rand -base64 32`. |
| Signed out after every API restart (dev) | No `JWT_ACCESS_SECRET` set, so a temporary one is generated. Set one in `apps/api/.env`. |
| Never received the verification email | Email is in mock mode: open `/dev/mailbox`. In production configure SMTP. |
| "Verify your email address before…" | Publishing and inviting need a verified email; use the banner's resend link. |
| Agent replies sound formulaic | You are on the mock AI. Set `AI_PROVIDER=openai` and `OPENAI_API_KEY`. |
| AI replies say "having trouble responding" | Provider error or timeout; see the agent's run log (`/agents/:id/runs`) and API logs. Check the key, model name and `AI_TIMEOUT_MS`. |
| A reply was replaced with "our team will confirm the pricing" | The output guard blocked an amount that is not in your catalogue. Add the price to the product, or check the run's flags. |
| Widget does not appear on my site | Domain not in the allow-list (check the browser console for a 403), the widget is disabled, or the snippet's key was rotated. `localhost` needs the port, e.g. `localhost:3000`. |
| Widget says "not available yet" | The agent is not published. |
| Widget replies arrive all at once / hang behind a proxy | The proxy buffers SSE; disable buffering for `/api/public/widget/*/messages`. |
| Knowledge source stuck in "Queued" | The job worker is off (`JOBS_ENABLED=false`) or the API is not running. |
| Website import fails with "only from your domain" | Set your website in Settings; only that domain and its subdomains can be imported. |
| PDF upload: "No text could be extracted" | The PDF is scanned images. Run OCR first, or paste the text. |
| HTTP 402 `limit_exceeded` | A plan limit was reached; see Plan and usage. |
| Refresh returns 409 | Two tabs refreshed at once; the client retries automatically. |
| Tests fail with ECONNREFUSED 27017 | Start MongoDB or set `TEST_MONGODB_URI`. |

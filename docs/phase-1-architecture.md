# NEXTWEBECCRM architecture

```text
Browser (same-origin HTML and JavaScript)
                 │ HttpOnly session cookie
                 ▼
           Express API (Node)
                 │ SQLite transactions
                 ▼
       data/nextwebec.db + sessions
```

The CRM runs as one Node application. Its schema is versioned in `server/migrations/`; `npm run migrate` applies each migration once. Auth uses bcrypt password hashes and an SQLite-backed session store. Backend handlers enforce the admin and sales roles, lead ownership, duplicate detection, payment rules and audit history.

The free GitHub Pages workflow was removed because it cannot run this backend or retain SQLite files. See the README for Docker, backups, HTTPS and the public hosting requirements.

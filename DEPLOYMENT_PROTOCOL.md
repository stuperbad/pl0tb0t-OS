# Deployment Protocol

## When to Commit

**DO NOT commit after every change.** Work locally, test locally, verify it works. Only commit when:
- Feature is complete and tested
- Bug is fixed and verified
- Benchmarks show improvement
- Breaking changes are intentional and documented

## Before Deployment

### 1. Verify All Changes (LOCAL)
```bash
git status                    # ensure working tree is clean or changes are staged
git diff HEAD                 # review uncommitted changes
git log -10 --oneline         # verify commit history
```

### 2. Commit Changes (if ready)
```bash
git add <files>
git commit -m "message"       # message should explain WHY, not what
git log -1                    # verify commit
```

### 3. Verify Push
```bash
git push
git log -1 --oneline          # verify it's on remote
```

### 4. Deploy to Pi (USER EXECUTES - Claude verifies)
Ask user to run:
```bash
cd ~/pl0tb0t-OS && git pull && sudo systemctl restart pl0tb0t-daemon
```

### 5. Verify Deployment
- Ask user to test specific feature
- Check logs: `cat ~/.pl0tb0t/debug.log` (tail -f for real-time)
- Confirm UI behavior matches intent
- If fails, DO NOT commit yet - fix locally and re-test

### 6. Document in Version
- Update `__version__` only when deploying to Pi
- Tag important commits: `git tag -a v0.4.19 -m "reason"`

---

## Git Strategy

**Small fixes**: Local → test → commit → push → deploy  
**Features**: Local (multiple commits) → test all together → push → deploy  
**Rollback**: Use `git revert <commit>` not `reset --hard` (preserves history)  

---

## Tools Used

| Tool | Purpose | Location |
|------|---------|----------|
| pl0tb0t_OS.py | PyQt6 GUI app | ~/pl0tb0t-OS/ |
| pl0tb0t_daemon.py | GRBL serial daemon | ~/pl0tb0t-OS/ |
| debug.log | Event logging | ~/.pl0tb0t/debug.log |
| queue_server | Job queue HTTP API | ~/queue_server/ |
| vpype | SVG → gcode | ~/.local/bin/vpype |
| GRBL | CNC controller | Pi serial port |

---

## Checklist (Claude Must Do Every Time)

- [ ] `git status` — verify working tree clean
- [ ] `git log -5` — verify commits present
- [ ] `grep <key_change>` — verify code contains fix
- [ ] `git push` — explicitly push and watch for success
- [ ] Create/update memory if behavior changes
- [ ] Ask user to test on Pi (don't assume)
- [ ] Check debug.log for errors
- [ ] Only commit when user confirms feature works

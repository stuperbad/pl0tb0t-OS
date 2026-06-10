# Claude's Deployment Musts

**Every time you make changes and user confirms they work on Pi, you MUST:**

## 1. Pre-Deployment Verification
- [ ] `git status` — verify working tree is clean
- [ ] `git log -1 --oneline` — last commit exists
- [ ] `grep <key_change>` — verify fix is in code (3+ examples minimum)
- [ ] Run command to show proof it's there

## 2. Commit (Only If User Confirmed Feature Works)
- [ ] `git add <files>`
- [ ] `git commit -m "clear message explaining WHY"`
- [ ] `git log -1` to verify
- [ ] Message format: `verb: change (reason)` e.g., `daemon: reduce serial timeout to 1ms for sub-10ms latency`

## 3. Push to Remote
- [ ] `git push`
- [ ] Verify "To https://github.com/..." output

## 4. Deploy to Pi (Choose One Strategy)

### Strategy A: SSH Direct (Faster, No Git History)
```bash
ssh pi@<IP>
cd ~/pl0tb0t-OS
# Pull latest (if using git) OR just restart daemon
sudo systemctl restart pl0tb0t-daemon
# Verify: tail -f ~/.pl0tb0t/debug.log
exit
```

### Strategy B: Git Pull (Version Control, Slower)
```bash
# Tell user to run:
# cd ~/pl0tb0t-OS && git pull && sudo systemctl restart pl0tb0t-daemon
# Wait for confirmation
```

## 5. Verify Deployment on Pi
- [ ] Ask user to test specific feature
- [ ] User checks: `tail -f ~/.pl0tb0t/debug.log`
- [ ] User confirms: "works" or "still broken"
- [ ] **ONLY update version if it works**

## 6. Update Version (If Confirmed Working)
- [ ] Increment `__version__` in pl0tb0t_OS.py
- [ ] `git add pl0tb0t_OS.py`
- [ ] `git commit -m "v0.4.XX: feature working"`
- [ ] `git push`

## 7. Document Change in Memory
- [ ] If user gives feedback on approach, save it
- [ ] Update DEPLOYMENT_PROTOCOL.md if process changed
- [ ] Tag important versions: `git tag -a v0.4.20 -m "reason"`

---

## When NOT to Commit
- ❌ Mid-development (code incomplete)
- ❌ Untested changes
- ❌ Before user confirms it works on Pi
- ❌ Small tweaks (unless bundled into a tested feature)

## When TO Commit
- ✅ User confirmed feature works
- ✅ Bug fix verified on Pi
- ✅ Benchmark shows improvement
- ✅ Breaking change (document in commit message)

---

## Tools Quick Ref
| Task | Command |
|------|---------|
| Check daemon log | `ssh pi@IP "tail -f ~/.pl0tb0t/debug.log"` |
| Restart daemon | `ssh pi@IP "sudo systemctl restart pl0tb0t-daemon"` |
| View daemon status | `ssh pi@IP "sudo systemctl status pl0tb0t-daemon"` |
| Pull latest code | `ssh pi@IP "cd ~/pl0tb0t-OS && git pull"` |
| Current version | `grep "__version__" pl0tb0t_OS.py` |
| Last 5 commits | `git log -5 --oneline` |

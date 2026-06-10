# Claude's Deployment Musts

**Every change to the OS: increment version, test on Pi, commit when working.**

## 1. Make Change (On Pi or Push to Pi)
- [ ] SSH to Pi: `ssh pl0tb0tpi5`
- [ ] Edit file directly OR push changes and `git pull` on Pi
- [ ] Save/confirm changes are there

## 2. Increment Version IMMEDIATELY
- [ ] `__version__` in pl0tb0t_OS.py → next increment (e.g., 0.4.19 → 0.4.20)
- [ ] Example: `__version__ = "0.4.20"`
- [ ] **Do this BEFORE testing, not after**

## 3. Restart Services (If Needed)
- [ ] If daemon changed: `pkill -f pl0tb0t_daemon.py && nohup python3 pl0tb0t_daemon.py &`
- [ ] If OS changed: restart the OS app
- [ ] If web app changed: refresh browser on Pi

## 4. Test on Pi Immediately
- [ ] **User tests the specific feature on Pi**
- [ ] Watch `tail -f ~/.pl0tb0t/debug.log` if needed
- [ ] User confirms: "works" or "broken"

## 5. If Broken: Fix and Re-Test
- [ ] Edit file on Pi
- [ ] Restart service
- [ ] Test again
- [ ] Repeat until working

## 6. If Working: Commit + Push
- [ ] `git add <files>`
- [ ] `git commit -m "v0.4.20: change (reason)"`
- [ ] `git push`
- [ ] Verify "To https://github.com/..." output

## 7. Document Change in Memory (If Needed)
- [ ] If user gave feedback on approach, save it
- [ ] Update DEPLOYMENT_PROTOCOL.md if process changed
- [ ] Tag major versions: `git tag -a v0.4.20 -m "reason"`

---

## Key Rule
**ANY change to pl0tb0t_OS.py or pl0tb0t_daemon.py → increment version immediately**

Don't wait. Don't ask. Just increment.

## Workflow (Not Local-First)
```
1. SSH to Pi
2. Edit on Pi (or git pull)
3. Increment version
4. Restart service
5. Test on Pi
6. If works → commit + push
7. If broken → fix + re-test
```

## Tools Quick Ref
| Task | Command |
|------|---------|
| Connect to Pi | `ssh pl0tb0tpi5` |
| View daemon log | `tail -f ~/.pl0tb0t/debug.log` |
| Restart daemon | `pkill -f pl0tb0t_daemon.py && nohup python3 pl0tb0t_daemon.py &` |
| Pull latest | `cd ~/Desktop/pl0tb0t-OS && git pull` |
| Check version | `grep "__version__" pl0tb0t_OS.py` |
| Last 5 commits | `git log -5 --oneline` |

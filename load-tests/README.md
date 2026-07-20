# Load tests (k6)

Scripts here should cover, per Section 26/27 of the spec:
- 400 simulated logins
- 400 assignment loads
- autosave activity under concurrent load
- simultaneous final submissions (the highest-risk spike)
- dashboard aggregation queries

Build these in Phase 10, against a seeded database with 30+ demo students
scaled up synthetically to 400 virtual users. Run with:

    k6 run load-tests/submission-spike.js

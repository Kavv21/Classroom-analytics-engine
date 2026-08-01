# Explicitly Excluded Features

Do not build, scaffold, stub, or leave disabled UI for any of the following.
If a task seems to require one of these, stop and ask instead of building a
partial version.

- Correct-answer grading, marks, scores, pass/fail labels, answer keys
- Online teaching videos or video hosting
- Webcam proctoring, microphone monitoring, screen recording
- Tab-switch detection, browser-blur/visibility-change enforcement,
  fullscreen enforcement
- Anti-cheat warnings or violation-event logging
- Automatic submission triggered by browser activity (tab switch, blur,
  refresh, disconnect, leaving the page)
- Controlled/locked-down assignment sessions
- Paid LLM dependency for any core workflow (any suggestion engine must use
  deterministic string/keyword matching only)
- Natural-language-to-SQL in the first release
- Facial recognition

Normal final submission and normal deadline-based closing of an assignment
are fine — the line is "monitoring/enforcing the student while they work,"
not "the assignment eventually closes."

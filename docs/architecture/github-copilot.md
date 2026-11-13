# GitHub Copilot threads

Pick **GitHub Copilot’s configured model** in the composer when starting or replying to a local thread.
Stop a running thread before switching it to Copilot. Choose **Log in** next to
**GitHub Copilot** on the welcome screen or in **Settings → Accounts**, then enter the code shown by Weft
on GitHub's device sign-in page.
The SDK handles authorization and saves the GitHub credential. Weft never asks for a token.

`lib/github-copilot-client.ts` starts the bundled GitHub Copilot SDK runtime over stdio with a filtered
environment and access to the system credential store. Weft disables project configuration discovery,
file hooks, and built-in tools for its sessions. Session data lives under `github-copilot` in Weft's data directory.
`lib/github-copilot-runner.ts` starts one runtime per turn, persists the SDK's session ID on the card
and resumes it on later turns. The runner stops the runtime on cancellation.

The initial backend uses the GitHub account's default model. It exposes three local tools to list
project directories, read text files, and replace text in an existing file. Each tool resolves its
path inside the card's folder and runs the shared guards. Each edit also asks on the card before
writing. Built-in Copilot tools, shell commands, workers, session forking and rewind are outside
this integration's scope.

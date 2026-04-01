# Profile README Commit Runner

An interactive CLI that finds a user's GitHub profile README repository and creates backdated commit activity there.

## What It Does

- detects the user's special GitHub profile README repo (`username/username`)
- asks simple questions in a guided flow
- creates backdated empty commits without copying product files into the profile repo
- lets the user create multiple batches of commits in one run
- can push the commits to GitHub at the end

## Requirements

- Node.js
- Git installed and available on PATH
- a cloned GitHub profile README repository on the PC
- GitHub authentication that can push to the user's repository
- GitHub Desktop is optional if normal Git push already works

## Install

```bash
npm install
```

## Run

```bash
npm start
```

The CLI will:

1. check setup
2. detect the profile README repo
3. ask for the start date
4. ask how many commits to create
5. ask whether to create another batch
6. ask whether to push to GitHub

## Notes

- The tool does not copy itself into the target profile repo.
- It creates empty commits, so the profile repo files stay unchanged.
- For GitHub to count the commits, the commits need to land on the correct branch and use a Git email linked to the user's GitHub account.

## License

MIT

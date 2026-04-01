import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import {
  access,
  constants,
  readdir,
  stat,
} from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import simpleGit from "simple-git";

const README_NAMES = ["README.md", "readme.md"];
const SEARCH_DEPTH = 4;
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  ".turbo",
  "dist",
  "build",
  "coverage",
  "AppData",
  "Library",
  "Program Files",
  "Program Files (x86)",
  "Windows",
  "$RECYCLE.BIN",
  "System Volume Information",
]);

function buildSuggestedStartDate() {
  const suggestedDate = new Date();
  suggestedDate.setMonth(suggestedDate.getMonth() - 1);
  suggestedDate.setDate(1);
  suggestedDate.setHours(0, 0, 0, 0);

  return formatCalendarDate(suggestedDate);
}

function describeRepo(repo) {
  return `${repo.owner}/${repo.repo} -> ${repo.repoPath}`;
}

async function askQuestion(rl, prompt) {
  return (await rl.question(prompt)).trim();
}

async function askWithDefault(rl, prompt, defaultValue) {
  const answer = await askQuestion(rl, `${prompt} [${defaultValue}]: `);
  return answer || defaultValue;
}

async function askYesNo(rl, prompt, defaultValue = true) {
  const suffix = defaultValue ? " (Y/n): " : " (y/N): ";

  while (true) {
    const answer = (await askQuestion(rl, `${prompt}${suffix}`)).toLowerCase();

    if (!answer) {
      return defaultValue;
    }

    if (answer === "y" || answer === "yes") {
      return true;
    }

    if (answer === "n" || answer === "no") {
      return false;
    }

    console.log("Please answer with y or n.");
  }
}

function showWelcome() {
  console.log("GitHub profile README commit runner");
  console.log("I will guide you step by step.");
  console.log("Steps: check setup, pick the repo, choose the date range, then create and push the commits.");
  console.log("This tool does not copy itself into your profile README repo.");
  console.log("");
}

function parseArgs(argv) {
  const options = {
    count: null,
    noPush: false,
    repoPath: null,
    skipDesktopCheck: false,
    startDate: null,
    assumeYes: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case "--count":
        options.count = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--repo":
        options.repoPath = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--start-date":
        options.startDate = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--no-push":
        options.noPush = true;
        break;
      case "--skip-desktop-check":
        options.skipDesktopCheck = true;
        break;
      case "--yes":
        options.assumeYes = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return options;
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(directoryPath) {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

function checkGitInstalled() {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });

  return result.status === 0 ? result.stdout.trim() : null;
}

async function findGitHubDesktopPath() {
  if (platform() === "win32") {
    const localAppData = process.env.LOCALAPPDATA;

    if (!localAppData) {
      return null;
    }

    const directExecutable = path.join(
      localAppData,
      "GitHubDesktop",
      "GitHubDesktop.exe",
    );

    if (existsSync(directExecutable)) {
      return directExecutable;
    }

    const appRoot = path.join(localAppData, "GitHubDesktop");

    if (!(await directoryExists(appRoot))) {
      return null;
    }

    const entries = await readdir(appRoot, { withFileTypes: true });
    const versions = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("app-"))
      .map((entry) => entry.name)
      .sort()
      .reverse();

    for (const version of versions) {
      const candidate = path.join(appRoot, version, "GitHubDesktop.exe");

      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  if (platform() === "darwin") {
    const macPath = "/Applications/GitHub Desktop.app";
    return existsSync(macPath) ? macPath : null;
  }

  return null;
}

async function validatePrerequisites() {
  const gitVersion = checkGitInstalled();

  if (!gitVersion) {
    throw new Error("Git was not found on PATH. Install Git first, then run npm start again.");
  }

  return {
    desktopPath: await findGitHubDesktopPath(),
    gitVersion,
  };
}

function parseGitHubRemote(remoteUrl) {
  if (!remoteUrl) {
    return null;
  }

  const normalized = remoteUrl.replace(/\.git$/i, "");
  const patterns = [
    /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+)$/i,
    /^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)$/i,
    /^ssh:\/\/git@github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (match?.groups) {
      return {
        owner: match.groups.owner,
        repo: match.groups.repo,
      };
    }
  }

  return null;
}

function formatCalendarDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function normalizeStartDateInput(rawValue) {
  const trimmed = rawValue.trim();
  const normalizedSeparators = trimmed.replace(/[/.\\]/g, "-");
  const parts = normalizedSeparators.split("-").filter(Boolean);

  if (parts.length !== 3) {
    throw new Error("Use a date like 2025-10-01 or 2025/10/1.");
  }

  const [yearText, monthText, dayText] = parts;

  if (!/^\d{4}$/.test(yearText) || !/^\d{1,2}$/.test(monthText) || !/^\d{1,2}$/.test(dayText)) {
    throw new Error("Use a date like 2025-10-01 or 2025/10/1.");
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  return {
    day,
    month,
    normalized: `${yearText}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    year,
  };
}

async function findReadmeFile(repoPath) {
  for (const name of README_NAMES) {
    const candidate = path.join(repoPath, name);

    if (await exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function getGitConfigValue(git, key) {
  try {
    return (await git.raw(["config", "--get", key])).trim();
  } catch {
    return "";
  }
}

async function getRemoteDefaultBranch(git) {
  try {
    const ref = (await git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"])).trim();
    return ref.split("/").at(-1) ?? null;
  } catch {
    return null;
  }
}

async function inspectProfileRepo(repoPath) {
  if (!(await directoryExists(repoPath))) {
    return null;
  }

  if (!(await exists(path.join(repoPath, ".git")))) {
    return null;
  }

  const readmePath = await findReadmeFile(repoPath);

  if (!readmePath) {
    return null;
  }

  const git = simpleGit(repoPath);
  const isRepo = await git.checkIsRepo();

  if (!isRepo) {
    return null;
  }

  const remotes = await git.getRemotes(true);
  const origin = remotes.find((remote) => remote.name === "origin");
  const remoteUrl = origin?.refs.push || origin?.refs.fetch || "";
  const remoteDetails = parseGitHubRemote(remoteUrl);

  if (!remoteDetails) {
    return null;
  }

  if (remoteDetails.owner.toLowerCase() !== remoteDetails.repo.toLowerCase()) {
    return null;
  }

  return {
    branch: (await git.branchLocal()).current,
    owner: remoteDetails.owner,
    readmePath,
    remoteUrl,
    repo: remoteDetails.repo,
    repoPath,
  };
}

function buildSearchRoots() {
  const home = homedir();
  const roots = [
    process.cwd(),
    path.dirname(process.cwd()),
    path.join(home, "Documents", "GitHub"),
    path.join(home, "source", "repos"),
    path.join(home, "Desktop"),
    path.join(home, "Projects"),
    path.join(home, "Developer"),
  ];

  return [...new Set(roots)];
}

async function discoverGitRepositories(rootPath, maxDepth, results, visited) {
  const normalized = path.resolve(rootPath);

  if (visited.has(normalized)) {
    return;
  }

  visited.add(normalized);

  if (!(await directoryExists(normalized))) {
    return;
  }

  if (await exists(path.join(normalized, ".git"))) {
    results.push(normalized);
    return;
  }

  if (maxDepth <= 0) {
    return;
  }

  let entries = [];

  try {
    entries = await readdir(normalized, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (SKIP_DIRECTORIES.has(entry.name)) {
      continue;
    }

    await discoverGitRepositories(
      path.join(normalized, entry.name),
      maxDepth - 1,
      results,
      visited,
    );
  }
}

async function findProfileRepoCandidates() {
  const discoveredRepos = [];
  const visited = new Set();

  for (const rootPath of buildSearchRoots()) {
    await discoverGitRepositories(rootPath, SEARCH_DEPTH, discoveredRepos, visited);
  }

  const inspected = await Promise.all(
    [...new Set(discoveredRepos)].map(async (repoPath) => {
      try {
        return await inspectProfileRepo(repoPath);
      } catch {
        return null;
      }
    }),
  );

  return inspected.filter(Boolean);
}

async function promptForManualRepoPath(rl) {
  while (true) {
    const answer = await askQuestion(
      rl,
      "Paste the full path to your cloned GitHub profile README repository: ",
    );

    if (!answer) {
      console.log("A repository path is required.");
      continue;
    }

    const repo = await inspectProfileRepo(answer);

    if (repo) {
      return repo;
    }

    console.log(
      "That path is not a valid GitHub profile README repository clone. The repo needs a GitHub origin like owner/owner and a README file.",
    );
  }
}

async function chooseProfileRepo(rl, candidates) {
  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length === 0) {
    console.log("No GitHub profile README repository was auto-detected.");
    return promptForManualRepoPath(rl);
  }

  console.log("Multiple GitHub profile README repositories were found:");

  candidates.forEach((candidate, index) => {
    console.log(
      `  ${index + 1}. ${candidate.owner}/${candidate.repo} -> ${candidate.repoPath}`,
    );
  });

  while (true) {
    const answer = await askQuestion(
      rl,
      "Choose a repository number, or paste a full path instead: ",
    );

    const selection = Number(answer);

    if (Number.isInteger(selection) && selection >= 1 && selection <= candidates.length) {
      return candidates[selection - 1];
    }

    if (answer) {
      const repo = await inspectProfileRepo(answer);

      if (repo) {
        return repo;
      }
    }

    console.log("Enter a valid number from the list, or paste a valid repository path.");
  }
}

async function resolveProfileRepo(options, rl) {
  const explicitRepoPath = options.repoPath || process.env.PROFILE_REPO_PATH;

  if (explicitRepoPath) {
    const explicitRepo = await inspectProfileRepo(explicitRepoPath);

    if (!explicitRepo) {
      throw new Error(
        "The repository passed through --repo or PROFILE_REPO_PATH is not a valid GitHub profile README clone.",
      );
    }

    return explicitRepo;
  }

  const currentRepo = await inspectProfileRepo(process.cwd());
  const excludedRepoPaths = new Set();

  if (currentRepo) {
    excludedRepoPaths.add(path.resolve(currentRepo.repoPath));

    if (
      options.assumeYes ||
      (await askYesNo(
        rl,
        `I found a GitHub profile README repo in this folder.\nUse ${describeRepo(currentRepo)}?`,
        true,
      ))
    ) {
      return currentRepo;
    }
  }

  const candidates = (await findProfileRepoCandidates()).filter(
    (candidate) => !excludedRepoPaths.has(path.resolve(candidate.repoPath)),
  );

  if (candidates.length === 1) {
    const detectedRepo = candidates[0];

    if (
      options.assumeYes ||
      (await askYesNo(
        rl,
        `I found your profile README repo automatically.\nUse ${describeRepo(detectedRepo)}?`,
        true,
      ))
    ) {
      return detectedRepo;
    }

    return promptForManualRepoPath(rl);
  }

  return chooseProfileRepo(rl, candidates);
}

function parseStartDate(rawValue) {
  const { year, month, day } = normalizeStartDateInput(rawValue);
  const parsed = new Date(year, month - 1, day);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("That start date could not be parsed.");
  }

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() + 1 !== month ||
    parsed.getDate() !== day
  ) {
    throw new Error("That date does not exist.");
  }

  if (parsed.getTime() > Date.now()) {
    throw new Error("The start date cannot be in the future.");
  }

  return parsed;
}

function parseCommitCount(rawValue) {
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Commit count must be a positive integer.");
  }

  return value;
}

async function promptForBatchDetails(rl, options, batchNumber) {
  console.log(`Batch ${batchNumber}`);
  const startDate =
    batchNumber === 1
      ? await promptForStartDate(rl, options.startDate)
      : await promptForStartDate(rl, null);
  const commitCount =
    batchNumber === 1
      ? await promptForCommitCount(rl, options.count)
      : await promptForCommitCount(rl, null);

  return {
    commitCount,
    startDate,
  };
}

async function promptForStartDate(rl, preset) {
  if (preset) {
    return parseStartDate(preset);
  }

  while (true) {
    const answer = await askWithDefault(
      rl,
      "When should the commit history begin? You can type 2025-10-01 or 2025/10/1",
      buildSuggestedStartDate(),
    );

    try {
      return parseStartDate(answer);
    } catch (error) {
      console.log(error.message);
    }
  }
}

async function promptForCommitCount(rl, preset) {
  if (preset !== null && preset !== undefined) {
    return parseCommitCount(preset);
  }

  while (true) {
    const answer = await askWithDefault(
      rl,
      "How many commits do you want me to create?",
      "30",
    );

    try {
      return parseCommitCount(answer);
    } catch (error) {
      console.log(error.message);
    }
  }
}

function buildCommitDates(startDate, count) {
  const startTime = startDate.getTime();
  const endTime = Date.now();
  const safeRange = Math.max(endTime - startTime + 1, count);
  const bucketSize = Math.max(1, Math.floor(safeRange / count));
  const commitDates = [];

  for (let index = 0; index < count; index += 1) {
    const bucketStart = Math.min(endTime, startTime + index * bucketSize);
    const nextBucketStart =
      index === count - 1
        ? endTime + 1
        : Math.min(endTime + 1, startTime + (index + 1) * bucketSize);
    const upperExclusive = Math.max(bucketStart + 1, nextBucketStart);
    const timestamp = randomInt(bucketStart, upperExclusive);

    commitDates.push(new Date(timestamp));
  }

  return commitDates.sort((left, right) => left.getTime() - right.getTime());
}

async function ensureRepoReady(repo) {
  if (!repo.branch) {
    throw new Error("The target repository is in a detached HEAD state. Check out a branch first.");
  }

  const git = simpleGit(repo.repoPath);
  const gitEmail = await getGitConfigValue(git, "user.email");

  if (!gitEmail) {
    throw new Error(
      "Git user.email is not configured for the target repository. Set it before creating commits so GitHub can attribute them correctly.",
    );
  }

  return {
    defaultBranch: await getRemoteDefaultBranch(git),
    gitEmail,
  };
}

async function createBackdatedCommits(repo, commitDates, startingIndex, grandTotal) {
  const progressGit = simpleGit(repo.repoPath);

  for (let index = 0; index < commitDates.length; index += 1) {
    const commitDate = commitDates[index];
    const dateString = commitDate.toISOString();
    await simpleGit(repo.repoPath)
      .env({
        GIT_AUTHOR_DATE: dateString,
        GIT_COMMITTER_DATE: dateString,
      })
      .raw([
        "commit",
        "--allow-empty",
        "--date",
        dateString,
        "-m",
        `chore: profile activity ${startingIndex + index + 1}/${grandTotal}`,
      ]);

    const completed = startingIndex + index + 1;

    if (completed % 25 === 0 || completed === grandTotal) {
      await progressGit.revparse(["HEAD"]);
      console.log(`Created ${completed}/${grandTotal} commits`);
    }
  }
}

async function promptForPushChoice(rl, options, desktopPath) {
  if (options.noPush) {
    return false;
  }

  const wantsPush = options.assumeYes
    ? true
    : await askYesNo(rl, "Do you want me to push the commits to GitHub now?", true);

  if (!wantsPush) {
    return false;
  }

  if (desktopPath || options.skipDesktopCheck) {
    return true;
  }

  console.log("");
  console.log("GitHub Desktop was not found.");
  console.log("If Git can already push to GitHub on this PC, I can continue without GitHub Desktop.");

  if (options.assumeYes) {
    throw new Error(
      "GitHub Desktop was not found. Install it first, or rerun with --skip-desktop-check if Git push authentication already works on this PC.",
    );
  }

  return askYesNo(rl, "Do you want me to try pushing without GitHub Desktop?", false);
}

async function confirmBatch(rl, startDate, commitCount) {
  console.log("");
  console.log(`Start date: ${formatCalendarDate(startDate)}`);
  console.log(`Commit count: ${commitCount}`);
  return askYesNo(rl, "Create this batch now?", true);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rl = readline.createInterface({ input, output });

  try {
    showWelcome();

    const prerequisites = await validatePrerequisites();
    console.log("Setup check complete.");
    console.log(prerequisites.gitVersion);

    if (prerequisites.desktopPath) {
      console.log("GitHub Desktop: detected");
    }

    console.log("");

    const repo = await resolveProfileRepo(options, rl);
    const repoState = await ensureRepoReady(repo);
    console.log("");
    console.log(`Using repo: ${describeRepo(repo)}`);
    console.log(`Current branch: ${repo.branch}`);
    console.log(`Git email: ${repoState.gitEmail}`);
    console.log("");

    const batches = [];
    let batchNumber = 1;

    while (true) {
      const batch = await promptForBatchDetails(rl, options, batchNumber);

      if (!options.assumeYes) {
        const approved = await confirmBatch(rl, batch.startDate, batch.commitCount);

        if (!approved) {
          console.log("Batch skipped.");
          console.log("");
          continue;
        }
      }

      batches.push(batch);

      if (
        options.assumeYes ||
        !(await askYesNo(rl, "Do you want to create another batch of commits?", false))
      ) {
        break;
      }

      batchNumber += 1;
      console.log("");
    }

    if (batches.length === 0) {
      console.log("No commits were created.");
      return;
    }

    console.log("");
    console.log("Creating commits...");
    console.log("");

    const totalCommitCount = batches.reduce(
      (sum, batch) => sum + batch.commitCount,
      0,
    );
    let createdSoFar = 0;

    for (const batch of batches) {
      const commitDates = buildCommitDates(batch.startDate, batch.commitCount);
      await createBackdatedCommits(repo, commitDates, createdSoFar, totalCommitCount);
      createdSoFar += batch.commitCount;
    }

    console.log("");
    console.log("All commit batches are done.");
    console.log("No extra product files were copied into your profile README repo.");

    if (repoState.defaultBranch && repoState.defaultBranch !== repo.branch) {
      console.log(
        `Warning: origin/${repoState.defaultBranch} looks like the default branch. Commits on ${repo.branch} may not count on the GitHub contribution graph until merged.`,
      );
    }

    const shouldPush = await promptForPushChoice(rl, options, prerequisites.desktopPath);

    if (!shouldPush) {
      console.log("Push skipped.");
      console.log("Your new commits exist locally in the profile repo.");
      return;
    }

    console.log("");
    console.log("Pushing commits...");

    await simpleGit(repo.repoPath).push("origin", repo.branch);
    console.log(`Pushed ${totalCommitCount} commits to origin/${repo.branch}`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  if (error.message === "readline was closed") {
    console.error("Cancelled.");
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});

/**
 * GitHub starts no run for a push whose commit message has one of its
 * "skip" words in it. A squash merge writes the pull request's title, and
 * its commits' messages or its description, into the commit on main, so
 * one of those words there meant main's newest commit had no CI run, and
 * nothing deployed it; the run before it didn't deploy either, as a newer
 * commit was on main (audit 7 H-5, run 32). Its own checks ran, as GitHub
 * only looks at a pull request's last commit.
 */

/**
 * The words in this text that stop GitHub's runs: "[skip ci]", "[ci skip]",
 * "[no ci]", "[skip actions]", "[actions skip]", and a "skip-checks: true"
 * line. Read in any case, so a few more than GitHub's count.
 */
export function skipCiWords(text: string): string[] {
  const words = text.matchAll(
    /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]|^\s*skip-checks:\s*true\b/gim,
  );
  return [...new Set([...words].map(([word]) => word.trim().toLowerCase()))];
}

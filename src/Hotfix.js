const NodeGit = require('nodegit');
const R = require('ramda');
const Config = require('./Config');

const constants = require('./constants');
const utils = require('./utils');

/**
 * All of this class' functions are attached to `NodeGit.Flow` or a `Flow` instance object
 * @class
 */
class Hotfix {
  constructor(repo) {
    this.repo = repo;
  }

  /**
   * Starts a git flow "hotfix"
   * @async
   * @param {Object}  repo          The repository to start a hotfix in
   * @param {String}  hotfixVersion The version of the hotfix to start
   * @param {Object}  options       Options for start hotfix
   * @return {Branch}   The nodegit branch for the hotfix
   */
  static startHotfix(repo, hotfixVersion) {
    if (!repo) {
      return Promise.reject(new Error(constants.ErrorMessage.REPO_REQUIRED));
    }

    if (!hotfixVersion) {
      return Promise.reject(new Error('Hotfix version is required'));
    }

    let hotfixBranchName;
    let hotfixBranch;

    return Config.getConfig(repo)
      .then((config) => {
        const hotfixPrefix = config['gitflow.prefix.hotfix'];
        const masterBranchName = config['gitflow.branch.master'];
        hotfixBranchName = hotfixPrefix + hotfixVersion;

        return NodeGit.Branch.lookup(
          repo,
          masterBranchName,
          NodeGit.Branch.BRANCH.LOCAL
        );
      })
      .then((masterBranch) => NodeGit.Commit.lookup(repo, masterBranch.target()))
      .then((localMasterCommit) => repo.createBranch(hotfixBranchName, localMasterCommit))
      .then((_hotfixBranch) => {
        hotfixBranch = _hotfixBranch;
        return repo.checkoutBranch(hotfixBranch);
      })
      .then(() => hotfixBranch);
  }

  /**
   * Finishes a git flow "hotfix"
   * @async
   * @param {Object}  repo            The repository to finish a hotfix in
   * @param {String}  hotfixVersion   The version of the hotfix to finish
   * @param {Object}  options         Options for finish hotfix
   * @return {Commit}   The commit created by finishing the hotfix
   */
  static finishHotfix(repo, hotfixVersion, options = {}) {
    const {
      keepBranch,
      message,
      processMergeMessageCallback,
      beforeMergeCallback = () => {},
      postDevelopMergeCallback = () => {},
      postMasterMergeCallback = () => {},
      postReleaseMergeCallback = () => {},
      selectReleaseBranchCallback = () => {}
    } = options;

    if (!repo) {
      return Promise.reject(new Error('Repo is required'));
    }

    if (!hotfixVersion) {
      return Promise.reject(new Error('Hotfix name is required'));
    }

    let hotfixBranchName;
    let releaseBranchPrefix;
    let secondaryMergeBranchName;
    let masterBranchName;
    let cancelMasterMerge;
    let cancelSecondaryMerge;
    let secondaryBranch;
    let hotfixBranch;
    let masterBranch;
    let hotfixCommit;
    let masterCommit;
    let secondaryCommit;
    let mergeCommit;
    let versionPrefix;
    let secondaryPostMergeCallback;
    return Config.getConfig(repo)
      .then((config) => {
        secondaryMergeBranchName = config['gitflow.branch.develop'];
        hotfixBranchName = config['gitflow.prefix.hotfix'] + hotfixVersion;
        masterBranchName = config['gitflow.branch.master'];
        versionPrefix = config['gitflow.prefix.versiontag'];
        releaseBranchPrefix = config['gitflow.prefix.release'];

        // This is the default, unless a single release branch exists, then use that
        secondaryPostMergeCallback = postDevelopMergeCallback;

        return repo.getReferences(NodeGit.References.TYPE.LISTALL);
      })
      .then((refs) => {
        const fullReleaseRefPrefix = `refs/heads/${releaseBranchPrefix}`;
        const releaseRefs = R.filter(r => r.name().startsWith(fullReleaseRefPrefix), refs);

        if (releaseRefs.length === 1) {
          secondaryPostMergeCallback = postReleaseMergeCallback;
          secondaryMergeBranchName = releaseRefs[0].name().substring(fullReleaseRefPrefix.length);
        }

        const selectReleaseBranchPromise
          = releaseRefs.length > 1
            ? selectReleaseBranchCallback
                .then(releaseName => {
                  secondaryPostMergeCallback = postReleaseMergeCallback;
                  secondaryMergeBranchName = releaseName;
                  return undefined;
                })
            : Promise.resolve();

        // Get the secondary, master, and hotfix branch
        const getBranchesPromise = Promise.all(
          [secondaryMergeBranchName, hotfixBranchName, masterBranchName]
            .map((branchName) => NodeGit.Branch.lookup(repo, branchName, NodeGit.Branch.BRANCH.LOCAL))
        );

        return R.pipeP(selectReleaseBranchPromise, getBranchesPromise)();
      })
      .then((branches) => {
        secondaryBranch = branches[0];
        hotfixBranch = branches[1];
        masterBranch = branches[2];

        // Get the commits that the secondary, master, and hotfix branches point to
        return Promise.all(branches.map((branch) => repo.getCommit(branch.target())));
      })
      .then((commits) => {
        secondaryCommit = commits[0];
        hotfixCommit = commits[1];
        masterCommit = commits[2];

        // If either secondary or master point to the same commit as the hotfix branch cancel
        // their respective merge
        cancelSecondaryMerge = secondaryCommit.id().toString() === hotfixCommit.id().toString();
        cancelMasterMerge = masterCommit.id().toString() === hotfixCommit.id().toString();

        // Merge hotfix into develop
        if (!cancelSecondaryMerge) {
          return Promise.resolve(beforeMergeCallback(secondaryMergeBranchName, hotfixBranchName))
            .then(() => utils.Repo.merge(secondaryBranch, hotfixBranch, repo, processMergeMessageCallback))
            .then(utils.InjectIntermediateCallback(secondaryPostMergeCallback));
        }
        return Promise.resolve();
      })
      .then((_mergeCommit) => {
        mergeCommit = _mergeCommit;

        const tagName = versionPrefix + hotfixVersion;
        // Merge the hotfix branch into master
        if (!cancelMasterMerge) {
          return Promise.resolve(beforeMergeCallback(masterBranchName, hotfixBranchName))
            .then(() => utils.Repo.merge(masterBranch, hotfixBranch, repo, processMergeMessageCallback))
            .then(utils.InjectIntermediateCallback(postMasterMergeCallback))
            .then((oid) => utils.Tag.create(oid, tagName, message, repo));
        }

        // If the merge is cancelled only tag the master commit
        const masterOid = NodeGit.Oid.fromString(masterCommit.id().toString());
        return utils.Tag.create(masterOid, tagName, message, repo);
      })
      .then(() => {
        if (keepBranch) {
          return Promise.resolve();
        }

        return hotfixBranch.delete();
      })
      .then(() => mergeCommit);
  }

  /**
   * Starts a git flow "hotfix"
   * @async
   * @param {String}  hotfixVersion The version of the hotfix to start
   * @param {Object}  options       Options for start hotfix
   * @return {Branch}   The nodegit branch for the hotfix
   */
  startHotfix() {
    return Hotfix.startHotfix(this.repo, ...arguments);
  }

  /**
   * Finishes a git flow "hotfix"
   * @async
   * @param {String}  hotfixVersion   The version of the hotfix to finish
   * @param {Object}  options         Options for finish hotfix
   * @return {Commit}   The commit created by finishing the hotfix
   */
  finishHotfix() {
    return Hotfix.finishHotfix(this.repo, ...arguments);
  }
}

module.exports = Hotfix;

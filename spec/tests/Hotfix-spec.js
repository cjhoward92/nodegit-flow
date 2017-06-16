/* eslint prefer-arrow-callback: 0 */

const Hotfix = require('../../src/Hotfix');
const NodeGit = require('../../src');
const RepoUtils = require('../utils/RepoUtils');

const utils = require('../../src/utils');

const expectStartHotfixSuccess = function expectStartHotfixSuccess(hotfixBranch, expectedBranchName) {
  expect(hotfixBranch.isBranch()).toBeTruthy();
  expect(hotfixBranch.shorthand()).toBe(expectedBranchName);
  expect(hotfixBranch.isHead()).toBeTruthy();
};

const expectFinishHotfixSuccess = function expectFinishHotfixSuccess(
  hotfixBranch,
  expectedTagName,
  branchName,
  keepBranch,
  branchMergeMessage,
  masterMergeMessage
) {
  let otherBranch;
  let masterBranch;
  let otherCommit;
  let masterCommit;
  const promise = Promise.all([branchName, this.config['gitflow.branch.master']].map(
    (branch) => NodeGit.Branch.lookup(
      this.repo,
      branch,
      NodeGit.Branch.BRANCH.LOCAL
    )
  ))
  .then((branches) => {
    otherBranch = branches[0];
    masterBranch = branches[1];
    expect(otherBranch.isHead());
    return Promise.all(branches.map((branch) => this.repo.getCommit(branch.target())));
  })
  .then((commits) => {
    otherCommit = commits[0];
    masterCommit = commits[1];
    const expectedDevelopCommitMessage
      = branchMergeMessage || utils.Merge.getMergeMessage(otherBranch, hotfixBranch);
    const expectedMasterCommitMessage
      = masterMergeMessage || utils.Merge.getMergeMessage(masterBranch, hotfixBranch);
    expect(otherCommit.message()).toBe(expectedDevelopCommitMessage);
    expect(masterCommit.message()).toBe(expectedMasterCommitMessage);
    return NodeGit.Reference.lookup(this.repo, expectedTagName);
  })
  .then((tag) => {
    expect(tag.isTag()).toBeTruthy();
    expect(tag.target()).toEqual(masterCommit.id());
    return NodeGit.Branch.lookup(this.repo, hotfixBranch.shorthand(), NodeGit.Branch.BRANCH.LOCAL);
  });

  if (!keepBranch) {
    return promise
      .catch((err) => {
        expect(err.message.toLowerCase()).toBe(`cannot locate local branch '${hotfixBranch.shorthand().toLowerCase()}'`);
      });
  }

  return promise;
};

describe('Hotfix', function() {
  beforeEach(function(done) {
    this.repoName = 'hotfixRepo';
    this.fileName = 'foobar.js';
    return RepoUtils.createRepo(this.repoName)
      .then((repo) => {
        this.repo = repo;
        return RepoUtils.commitFileToRepo(
          this.repo,
          this.fileName,
          'Line1\nLine2\nLine3'
        );
      })
      .then((firstCommit) => {
        this.firstCommit = firstCommit;
        this.config = NodeGit.Flow.getConfigDefault();
        this.hotfixPrefix = this.config['gitflow.prefix.hotfix'];
        this.versionPrefix = this.config['gitflow.prefix.versiontag'];
        this.releasePrefix = this.config['gitflow.prefix.release'];
        this.developBranch = this.config['gitflow.branch.develop'];

        return NodeGit.Flow.init(this.repo, this.config);
      })
      .then((flow) => {
        this.flow = flow;
        done();
      });
  });

  afterEach(function() {
    RepoUtils.deleteRepo(this.repoName);
  });

  it('should be able to start hotfix statically', function(done) {
    const hotfixName = '1.0.0';
    Hotfix.startHotfix(this.repo, hotfixName)
      .then((hotfixBranch) => {
        expectStartHotfixSuccess(hotfixBranch, this.hotfixPrefix + hotfixName);
        done();
      });
  });

  it('should be able to start hotfix using flow instance', function(done) {
    const hotfixName = '1.0.0';
    this.flow.startHotfix(hotfixName)
      .then((hotfixBranch) => {
        expectStartHotfixSuccess(hotfixBranch, this.hotfixPrefix + hotfixName);
        done();
      });
  });

  it('should be able to finish hotfix statically', function(done) {
    const hotfixName = '1.0.0';
    const fullTagName = `refs/tags/${this.versionPrefix}${hotfixName}`;
    let hotfixBranch;
    Hotfix.startHotfix(this.repo, hotfixName)
      .then((_hotfixBranch) => {
        hotfixBranch = _hotfixBranch;
        expectStartHotfixSuccess(hotfixBranch, this.hotfixPrefix + hotfixName);
        return RepoUtils.commitFileToRepo(
          this.repo,
          'anotherFile.js',
          'Hello World',
          'second commit',
          this.firstCommit
        );
      })
      .then(() => Hotfix.finishHotfix(this.repo, hotfixName))
      .then(() => expectFinishHotfixSuccess.call(this, hotfixBranch, fullTagName, this.developBranch))
      .then(done);
  });

  it('should be able to finish hotfix using flow instance', function(done) {
    const hotfixName = '1.0.0';
    const fullTagName = `refs/tags/${this.versionPrefix}${hotfixName}`;
    let hotfixBranch;
    this.flow.startHotfix(hotfixName)
      .then((_hotfixBranch) => {
        hotfixBranch = _hotfixBranch;
        expectStartHotfixSuccess(hotfixBranch, this.hotfixPrefix + hotfixName);

        return RepoUtils.commitFileToRepo(
          this.repo,
          'anotherFile.js',
          'Hello World',
          'second commit',
          this.firstCommit
        );
      })
      .then(() => this.flow.finishHotfix(hotfixName))
      .then(() => expectFinishHotfixSuccess.call(this, hotfixBranch, fullTagName, this.developBranch))
      .then(done);
  });

  it('should be able to finish hotfix statically and keep the branch', function(done) {
    const hotfixName = '1.0.0';
    const fullTagName = `refs/tags/${this.versionPrefix}${hotfixName}`;
    let hotfixBranch;
    Hotfix.startHotfix(this.repo, hotfixName)
      .then((_hotfixBranch) => {
        hotfixBranch = _hotfixBranch;
        expectStartHotfixSuccess(hotfixBranch, this.hotfixPrefix + hotfixName);
        return RepoUtils.commitFileToRepo(
          this.repo,
          'anotherFile.js',
          'Hello World',
          'second commit',
          this.firstCommit
        );
      })
      .then(() => Hotfix.finishHotfix(this.repo, hotfixName, {keepBranch: true}))
      .then(() => expectFinishHotfixSuccess.call(this, hotfixBranch, fullTagName, this.developBranch, true))
      .then(done);
  });

  it('should be able to finish hotfix statically and keep the branch when a single release branch exists',
    function(done) {
      const hotfixName = '1.0.0';
      const fullTagName = `refs/tags/${this.versionPrefix}${hotfixName}`;
      const releaseBranch = `${this.releasePrefix}test`;

      let hotfixBranch;
      Hotfix.startHotfix(this.repo, hotfixName)
        .then((_hotfixBranch) => {
          hotfixBranch = _hotfixBranch;
          expectStartHotfixSuccess(hotfixBranch, this.hotfixPrefix + hotfixName);
          return RepoUtils.commitFileToRepo(
            this.repo,
            'anotherFile.js',
            'Hello World',
            'second commit',
            this.firstCommit
          );
        })
        .then(() => this.repo.createBranch(releaseBranch, this.firstCommit.id()))
        .then(() => this.repo.checkoutBranch(hotfixBranch))
        .then(() => Hotfix.finishHotfix(this.repo, hotfixName, {keepBranch: true}))
        .then(() => expectFinishHotfixSuccess.call(this, hotfixBranch, fullTagName, releaseBranch, true))
        .then(done);
    });

  it('should be able to finish hotfix statically and keep the branch when multiple release branches exists',
    function(done) {
      const hotfixName = '1.0.0';
      const fullTagName = `refs/tags/${this.versionPrefix}${hotfixName}`;
      const releaseBranch = `${this.releasePrefix}test`;
      const otherReleaseBranch = `${this.releasePrefix}test2`;
      const selectReleaseBranchCallback = (refs) => {
        return Promise.resolve(refs[0]);
      };

      let hotfixBranch;
      Hotfix.startHotfix(this.repo, hotfixName)
        .then((_hotfixBranch) => {
          hotfixBranch = _hotfixBranch;
          expectStartHotfixSuccess(hotfixBranch, this.hotfixPrefix + hotfixName);
          return RepoUtils.commitFileToRepo(
            this.repo,
            'anotherFile.js',
            'Hello World',
            'second commit',
            this.firstCommit
          );
        })
        .then(() => this.repo.createBranch(releaseBranch, this.firstCommit.id()))
        .then(() => this.repo.createBranch(otherReleaseBranch, this.firstCommit.id()))
        .then(() => this.repo.checkoutBranch(hotfixBranch))
        .then(() => Hotfix.finishHotfix(this.repo, hotfixName, {keepBranch: true, selectReleaseBranchCallback}))
        .then(() => expectFinishHotfixSuccess.call(this, hotfixBranch, fullTagName, releaseBranch, true))
        .then(done);
    });

  it('should be able to finish hotfix using flow instance and keep the branch', function(done) {
    const hotfixName = '1.0.0';
    const fullTagName = `refs/tags/${this.versionPrefix}${hotfixName}`;
    let hotfixBranch;
    this.flow.startHotfix(hotfixName)
      .then((_hotfixBranch) => {
        hotfixBranch = _hotfixBranch;
        expectStartHotfixSuccess(hotfixBranch, this.hotfixPrefix + hotfixName);

        return RepoUtils.commitFileToRepo(
          this.repo,
          'anotherFile.js',
          'Hello World',
          'second commit',
          this.firstCommit
        );
      })
      .then(() => this.flow.finishHotfix(hotfixName, {keepBranch: true}))
      .then(() => expectFinishHotfixSuccess.call(this, hotfixBranch, fullTagName, this.developBranch, true))
      .then(done);
  });

  it('should be able to finish a hotfix that is still pointed at master', function(done) {
    const hotfixName = '1.0.0';
    const fullTagName = `refs/tags/${this.versionPrefix}${hotfixName}`;
    const expectedCommitMessage = 'initial commit';
    let hotfixBranch;
    this.flow.startHotfix(hotfixName)
      .then((_hotfixBranch) => {
        hotfixBranch = _hotfixBranch;
        expectStartHotfixSuccess(hotfixBranch, this.hotfixPrefix + hotfixName);
        return this.flow.finishHotfix(hotfixName, {keepBranch: true});
      })
      .then(() => expectFinishHotfixSuccess.call(
        this,
        hotfixBranch,
        fullTagName,
        this.developBranch,
        true,
        expectedCommitMessage,
        expectedCommitMessage
      ))
      .then(done);
  });
});

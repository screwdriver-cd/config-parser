'use strict';
const assert = require('chai').assert;
const parser = require('../');
const fs = require('fs');
const path = require('path');

/**
 * Load sample data from disk
 * @method loadData
 * @param  {String} name Filename to read (inside data dir)
 * @return {String}      Contents of file
 */
function loadData(name) {
    return fs.readFileSync(path.join(__dirname, 'data', name), 'utf-8');
}

describe('config parser', () => {
    describe('yaml parser', () => {
        it('returns an error if unparsable yaml', (done) => {
            parser('foo: :', (err) => {
                assert.isNotNull(err);
                assert.match(err.toString(), /YAMLException:/);
                done();
            });
        });
    });

    describe('structure validation', () => {
        describe('overall config', () => {
            it('returns an error if missing jobs', (done) => {
                parser('foo: bar', (err) => {
                    assert.isNotNull(err);
                    assert.match(err.toString(), /"jobs" is required/);
                    done();
                });
            });
        });

        describe('jobs', () => {
            it('returns an error if missing main job', (done) => {
                parser(loadData('missing-main-job.yaml'), (err) => {
                    assert.isNotNull(err);
                    assert.match(err.toString(), /"main" is required/);
                    done();
                });
            });
        });

        describe('steps', () => {
            it('returns an error if not bad named steps', (done) => {
                parser(loadData('bad-step-name.yaml'), (err) => {
                    assert.isNotNull(err);
                    assert.match(err.toString(),
                        /"foo bar" only supports the following characters A-Z,a-z,0-9,-,_/);
                    done();
                });
            });
        });

        describe('environment', () => {
            it('returns an error if bad environment name', (done) => {
                parser(loadData('bad-environment-name.yaml'), (err) => {
                    assert.isNotNull(err);
                    assert.match(err.toString(), /"foo bar" only supports uppercase letters,/);
                    done();
                });
            });
        });

        describe('matrix', () => {
            it('returns an error if bad matrix name', (done) => {
                parser(loadData('bad-matrix-name.yaml'), (err) => {
                    assert.isNotNull(err);
                    assert.match(err.toString(), /"foo bar" only supports uppercase letters,/);
                    done();
                });
            });
        });
    });

    describe('flatten', () => {
        it('replaces steps, matrix, image, but merges environment', (done) => {
            parser(loadData('basic-shared-project.yaml'), (err, data) => {
                assert.isNull(err);
                assert.deepEqual(data, JSON.parse(loadData('basic-shared-project.json')));
                done();
            });
        });

        it('flattens complex environments', (done) => {
            parser(loadData('complex-environment.yaml'), (err, data) => {
                assert.isNull(err);
                assert.deepEqual(data, JSON.parse(loadData('complex-environment.json')));
                done();
            });
        });
    });

    describe('functional', () => {
        it('returns an error if not enough steps', (done) => {
            parser(loadData('not-enough-commands.yaml'), (err) => {
                assert.isNotNull(err);
                assert.match(err.toString(), /"steps" must contain at least 1 items/);
                done();
            });
        });

        it('returns an error if too many environment variables', (done) => {
            parser(loadData('too-many-environment.yaml'), (err) => {
                assert.isNotNull(err);
                assert.match(err.toString(), /"environment" can only have 25 environment/);
                done();
            });
        });

        it('returns an error if too many environment + matrix variables', (done) => {
            parser(loadData('too-many-matrix.yaml'), (err) => {
                assert.isNotNull(err);
                assert.match(err.toString(), /"environment" and "matrix" can only have a combined/);
                done();
            });
        });

        it('returns an error if workflow is missing main', (done) => {
            parser(loadData('workflow-main-not-first.yaml'), (err) => {
                assert.isNotNull(err);
                assert.match(err.toString(), /Workflow: "main" is implied as the first job/);
                done();
            });
        });

        it('returns an error if workflow contains different jobs', (done) => {
            parser(loadData('workflow-wrong-jobs.yaml'), (err) => {
                assert.isNotNull(err);
                assert.match(err.toString(), /Workflow: must contain all the jobs listed/);
                done();
            });
        });

        it('returns an error if matrix is too big', (done) => {
            parser(loadData('too-big-matrix.yaml'), (err) => {
                assert.isNotNull(err);
                assert.match(err.toString(), /Job "main": "matrix" cannot contain >25 perm/);
                done();
            });
        });

        it('returns an error if using restricted step names', (done) => {
            parser(loadData('restricted-step-name.yaml'), (err) => {
                assert.isNotNull(err);
                assert.match(err.toString(),
                    /Job "main": Step "sd-setup": cannot use a restricted prefix "sd-"/);
                done();
            });
        });
    });

    describe('permutation', () => {
        it('generates complex permutations and expands image', (done) => {
            parser(loadData('node-module.yaml'), (err, data) => {
                assert.isNull(err);
                assert.deepEqual(data, JSON.parse(loadData('node-module.json')));
                done();
            });
        });
    });
});

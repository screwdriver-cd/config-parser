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
    describe('input validation', () => {
        it('returns an error if unparsable yaml', (done) => {
            parser({
                yaml: 'foo: :',
                jobName: 'main'
            }, (err) => {
                assert.isNotNull(err);
                assert.match(err.toString(), /YAMLException:/);
                done();
            });
        });

        it('returns an error if missing fields', (done) => {
            parser({}, (err) => {
                assert.isNotNull(err);
                assert.match(err.toString(), /ValidationError/);
                done();
            });
        });
    });

    describe('config validation', () => {
        describe('overall config', () => {
            it('returns an error if missing jobs', (done) => {
                parser({
                    yaml: 'foo: bar'
                }, (err) => {
                    assert.isNotNull(err);
                    assert.match(err.toString(), /"jobs" is required/);
                    done();
                });
            });
        });

        describe('jobs', () => {
            it('returns an error if missing main job', (done) => {
                parser({
                    yaml: loadData('missing-main-job.yaml')
                }, (err) => {
                    assert.isNotNull(err);
                    assert.match(err.toString(), /"main" is required/);
                    done();
                });
            });

            it('returns an error if missing desired job', (done) => {
                parser({
                    yaml: loadData('basic-project.yaml'),
                    jobName: 'barfoo'
                }, (err) => {
                    assert.isNotNull(err);
                    assert.match(err.toString(), /"barfoo" is required/);
                    done();
                });
            });
        });

        describe('steps', () => {
            it('returns an error if not enough steps', (done) => {
                parser({
                    yaml: loadData('not-enough-commands.yaml')
                }, (err) => {
                    assert.isNotNull(err);
                    assert.match(err.toString(), /"steps" requires at least one step/);
                    done();
                });
            });

            it('returns an error if not bad named steps', (done) => {
                parser({
                    yaml: loadData('bad-step-name.yaml')
                }, (err) => {
                    assert.isNotNull(err);
                    assert.match(err.toString(),
                        /"foo bar" only supports the following characters A-Z,a-z,0-9,-,_/);
                    done();
                });
            });
        });
    });

    describe('execute', () => {
        it('returns execution plans for basic project', (done) => {
            parser({
                yaml: loadData('basic-project.yaml')
            }, (err, data) => {
                assert.isNull(err);
                assert.deepEqual(data.execute, {
                    install: 'npm install',
                    test: 'npm test',
                    publish: 'npm publish'
                });
                done();
            });
        });

        it('returns execution plans for basic non-main job', (done) => {
            parser({
                yaml: loadData('basic-project.yaml'),
                jobName: 'foobar'
            }, (err, data) => {
                assert.isNull(err);
                assert.deepEqual(data.execute, {
                    install: 'npm install',
                    test: 'npm test'
                });
                done();
            });
        });
    });
});

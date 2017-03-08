'use strict';

const assert = require('chai').assert;
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const parser = require('../');

sinon.assert.expose(assert, { prefix: '' });
require('sinon-as-promised');

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
        it('returns an error if unparsable yaml', () =>
            parser('foo: :')
                .then((data) => {
                    assert.deepEqual(data.workflow, ['main']);
                    assert.strictEqual(data.jobs.main[0].image, 'node:6');
                    assert.deepEqual(data.jobs.main[0].image, 'node:6');
                    assert.deepEqual(data.jobs.main[0].secrets, []);
                    assert.deepEqual(data.jobs.main[0].environment, {});
                    assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                    assert.match(data.jobs.main[0].commands[0].command, /YAMLException:/);
                })
        );
    });

    describe('structure validation', () => {
        describe('overall config', () => {
            it('returns an error if missing jobs', () =>
                parser('foo: bar')
                    .then((data) => {
                        assert.match(data.jobs.main[0].commands[0].command, /"jobs" is required/);
                    })
            );
        });

        describe('jobs', () => {
            it('returns an error if missing main job', () =>
                parser(loadData('missing-main-job.yaml'))
                    .then((data) => {
                        assert.match(data.jobs.main[0].commands[0].command, /"main" is required/);
                    })
            );
        });

        describe('steps', () => {
            it('returns an error if not bad named steps', () =>
                parser(loadData('bad-step-name.yaml'))
                    .then((data) => {
                        assert.match(data.jobs.main[0].commands[0].command,
                            /"foo bar" only supports the following characters A-Z,a-z,0-9,-,_/);
                    })
            );
        });

        describe('environment', () => {
            it('returns an error if bad environment name', () =>
                parser(loadData('bad-environment-name.yaml'))
                    .then((data) => {
                        assert.match(data.jobs.main[0].commands[0].command,
                            /"foo bar" only supports uppercase letters,/);
                    })
            );
        });

        describe('matrix', () => {
            it('returns an error if bad matrix name', () =>
                parser(loadData('bad-matrix-name.yaml'))
                    .then((data) => {
                        assert.match(data.jobs.main[0].commands[0].command,
                            /"foo bar" only supports uppercase letters,/);
                    })
            );
        });
    });

    describe('flatten', () => {
        it('replaces steps, matrix, image, but merges environment', () =>
            parser(loadData('basic-shared-project.yaml'))
                .then((data) => {
                    assert.deepEqual(data, JSON.parse(loadData('basic-shared-project.json')));
                })
        );

        it('flattens complex environments', () =>
            parser(loadData('complex-environment.yaml'))
                .then((data) => {
                    assert.deepEqual(data, JSON.parse(loadData('complex-environment.json')));
                })
        );

        describe('templates', () => {
            const firstTemplate = JSON.parse(loadData('template.json'));
            const secondTemplate = JSON.parse(loadData('template-2.json'));
            const templateFactoryMock = {
                getTemplate: sinon.stub()
            };
            const firstTemplateConfig = {
                name: 'mytemplate',
                version: '1.2.3',
                label: ''
            };
            const secondTemplateConfig = {
                name: 'yourtemplate',
                version: '2',
                label: 'stable'
            };

            it('flattens templates sucessfully', () => {
                templateFactoryMock.getTemplate.withArgs(firstTemplateConfig)
                    .resolves(firstTemplate);
                templateFactoryMock.getTemplate.withArgs(secondTemplateConfig)
                    .resolves(secondTemplate);

                return parser(loadData('basic-job-with-template.yaml'), templateFactoryMock)
                  .then((data) => {
                      assert.deepEqual(data, JSON.parse(loadData('basic-job-with-template.json')));
                  });
            });

            it('returns error if template does not exist', () => {
                templateFactoryMock.getTemplate.withArgs(firstTemplateConfig)
                    .resolves(null);
                templateFactoryMock.getTemplate.withArgs(secondTemplateConfig)
                    .resolves(secondTemplate);

                return parser(loadData('basic-job-with-template.yaml'), templateFactoryMock)
                    .then((data) => {
                        assert.match(data.jobs.main[0].commands[0].command,
                            /Template mytemplate@1.2.3 does not exist/);
                    });
            });

            it('returns error if template (with label) does not exist', () => {
                templateFactoryMock.getTemplate.withArgs(firstTemplateConfig)
                    .resolves(firstTemplate);
                templateFactoryMock.getTemplate.withArgs(secondTemplateConfig)
                    .resolves(null);

                return parser(loadData('basic-job-with-template.yaml'), templateFactoryMock)
                    .then((data) => {
                        assert.match(data.jobs.main[0].commands[0].command,
                            /Template yourtemplate@2 with label 'stable' does not exist/);
                    });
            });
        });
    });

    describe('functional', () => {
        it('returns an error if not enough steps', () =>
            parser(loadData('not-enough-commands.yaml'))
                .then((data) => {
                    assert.match(data.jobs.main[0].commands[0].command,
                        /"steps" must contain at least 1 items/);
                })
        );

        it('returns an error if too many environment variables', () =>
            parser(loadData('too-many-environment.yaml'))
                .then((data) => {
                    assert.match(data.jobs.main[0].commands[0].command,
                        /"environment" can only have 25 environment/);
                })
        );

        it('returns an error if too many environment + matrix variables', () =>
            parser(loadData('too-many-matrix.yaml'))
                .then((data) => {
                    assert.match(data.jobs.main[0].commands[0].command,

                        /"environment" and "matrix" can only have a combined/);
                })
        );

        it('returns an error if workflow is main is not the first job', () =>
            parser(loadData('workflow-main-not-first.yaml'))
                .then((data) => {
                    assert.match(data.jobs.main[0].commands[0].command,
                        /Workflow: "main" is implied as the first job/);
                })
        );

        it('returns an error if workflow contains different jobs', () =>
            parser(loadData('workflow-wrong-jobs.yaml'))
                .then((data) => {
                    assert.match(data.jobs.main[0].commands[0].command,
                        /Workflow: must contain all the jobs listed/);
                })
        );

        it('returns an error if matrix is too big', () =>
            parser(loadData('too-big-matrix.yaml'))
                .then((data) => {
                    assert.match(data.jobs.main[0].commands[0].command,
                        /Job "main": "matrix" cannot contain >25 perm/);
                })
        );

        it('returns an error if using restricted step names', () =>
            parser(loadData('restricted-step-name.yaml'))
                .then((data) => {
                    assert.match(data.jobs.main[0].commands[0].command,
                        /Job "main": Step "sd-setup": cannot use a restricted prefix "sd-"/);
                })
        );

        it('returns an error if using restricted job names', () =>
            parser(loadData('restricted-job-name.yaml'))
                .then((data) => {
                    assert.match(data.jobs.main[0].commands[0].command,
                        /Job "pr-15": cannot use a restricted prefix "pr-"/);
                })
        );
    });

    describe('permutation', () => {
        it('generates complex permutations and expands image', () =>
            parser(loadData('node-module.yaml'))
                .then((data) => {
                    assert.deepEqual(data, JSON.parse(loadData('node-module.json')));
                })
        );
    });
});

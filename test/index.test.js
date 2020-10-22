'use strict';

const { assert } = require('chai');
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const parser = require('../');
const pipelineId = 111;

sinon.assert.expose(assert, { prefix: '' });

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
        it('returns an error if yaml does not exist', () => {
            const YAMLMISSING = /screwdriver.yaml does not exist/;

            return parser('')
                .then((data) => {
                    assert.deepEqual(data.workflowGraph, {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'main' },
                            { name: '~pr:/.*/' }
                        ],
                        edges: [
                            { src: '~pr', dest: 'main' },
                            { src: '~commit', dest: 'main' },
                            { src: '~pr:/.*/', dest: 'main' }
                        ]
                    });
                    assert.strictEqual(data.jobs.main[0].image, 'node:12');
                    assert.deepEqual(data.jobs.main[0].secrets, []);
                    assert.deepEqual(data.jobs.main[0].environment, {});
                    assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                    assert.match(data.jobs.main[0].commands[0].command, YAMLMISSING);
                    assert.match(data.errors[0], YAMLMISSING);
                });
        });

        it('returns an error if unparsable yaml', () => parser('foo: :')
            .then((data) => {
                assert.strictEqual(data.jobs.main[0].image, 'node:12');
                assert.deepEqual(data.jobs.main[0].secrets, []);
                assert.deepEqual(data.jobs.main[0].environment, {});
                assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                assert.match(data.jobs.main[0].commands[0].command, /YAMLException:/);
                assert.match(data.errors[0], /YAMLException:/);
            }));

        it('returns an error if job has duplicate steps',
            () => parser(loadData('basic-job-with-duplicate-steps.yaml'))
                .then((data) => {
                    assert.strictEqual(data.jobs.main[0].image, 'node:12');
                    assert.deepEqual(data.jobs.main[0].secrets, []);
                    assert.deepEqual(data.jobs.main[0].environment, {});
                    assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                    assert.match(data.jobs.main[0].commands[0].command,
                        /Error:.*main has duplicate step: publish/);
                    assert.match(data.errors[0], /Error:.*main has duplicate step: publish/);
                }));

        it('does not return an error if job has no step names',
            () => parser(loadData('basic-job-with-no-step-names.yaml')).then((data) => {
                assert.strictEqual(data.jobs.main[0].image, 'node:6');
                assert.deepEqual(data.jobs.main[0].secrets, []);
                assert.deepEqual(data.jobs.main[0].environment, {});
                assert.notOk(data.errors);
            }));

        it('returns an error if multiple documents without hint',
            () => parser('foo: bar\n---\nfoo: baz')
                .then((data) => {
                    assert.strictEqual(data.jobs.main[0].image, 'node:12');
                    assert.deepEqual(data.jobs.main[0].secrets, []);
                    assert.deepEqual(data.jobs.main[0].environment, {});
                    assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                    assert.match(data.jobs.main[0].commands[0].command,
                        /YAMLException:.*ambigious/);
                    assert.match(data.errors[0], /YAMLException:.*ambigious/);
                }));

        it('picks the document with version hint', () => parser('jobs: {}\n---\nversion: 4')
            .then((data) => {
                assert.strictEqual(data.jobs.main[0].image, 'node:12');
                assert.deepEqual(data.jobs.main[0].secrets, []);
                assert.deepEqual(data.jobs.main[0].environment, {});
                assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                assert.match(data.jobs.main[0].commands[0].command,
                    /ValidationError:.*"jobs" is required/);
                assert.match(data.errors[0], /ValidationError:.*"jobs" is required/);
            }));
    });

    describe('structure validation', () => {
        describe('overall config', () => {
            it('returns an error if missing jobs', () => parser('foo: bar')
                .then((data) => {
                    assert.match(data.jobs.main[0].commands[0].command, /"jobs" is required/);
                    assert.match(data.errors[0], /"jobs" is required/);
                }));
        });

        describe('jobs', () => {
            it('Do not return error if missing main job for new config',
                () => parser(loadData('missing-main-job-with-requires.yaml'))
                    .then((data) => {
                        assert.notOk(data.errors);
                    }));
        });

        describe('steps', () => {
            it('returns an error if not bad named steps',
                () => parser(loadData('bad-step-name.yaml'))
                    .then((data) => {
                        assert.match(data.jobs.main[0].commands[0].command,
                            /.foo bar" only supports the following characters A-Z,a-z,0-9,-,_';/);
                    }));

            it('returns an error if teardown step is not at the end',
                () => parser(loadData('bad-step-teardown.yaml'))
                    .then((data) => {
                        assert.match(data.errors[0],
                            /User teardown steps need to be at the end/);
                    }));
        });

        describe('environment', () => {
            it('returns an error if bad environment name',
                () => parser(loadData('bad-environment-name.yaml'))
                    .then((data) => {
                        assert.match(data.jobs.main[0].commands[0].command,
                            /"jobs.main.environment.foo bar" only supports uppercase letters,/);
                    }));
        });

        describe('matrix', () => {
            it('returns an error if bad matrix name', () => parser(loadData('bad-matrix-name.yaml'))
                .then((data) => {
                    assert.match(data.jobs.main[0].commands[0].command,
                        /"jobs.main.matrix.foo bar" only supports uppercase letters,/);
                }));
        });

        describe('childPipelines', () => {
            it('returns an error if bad childPipelines',
                () => parser(loadData('bad-external-scm.yaml'))
                    .then((data) => {
                        assert.match(data.jobs.main[0].commands[0].command,
                            /"fakeScmUrl" fails to match the required pattern:/);
                    }));
        });

        describe('subscribe', () => {
            it('fetches subscribe from the config and adds to parsed doc',
                () => parser(loadData('pipeline-with-subscribed-scms.yaml'))
                    .then((data) => {
                        assert.deepEqual(data,
                            JSON.parse(loadData('pipeline-with-subscribed-scms.json')));
                    }));
        });
    });

    describe('flatten', () => {
        it('replaces steps, matrix, image, but merges environment',
            () => parser(loadData('basic-shared-project.yaml'))
                .then((data) => {
                    assert.deepEqual(data, JSON.parse(loadData('basic-shared-project.json')));
                }));

        it('flattens complex environments', () => parser(loadData('complex-environment.yaml'))
            .then((data) => {
                assert.deepEqual(data, JSON.parse(loadData('complex-environment.json')));
            }));

        it('flattens shared annotations to each job',
            () => parser(loadData('shared-annotations.yaml'))
                .then((data) => {
                    assert.deepEqual(data, JSON.parse(loadData('shared-annotations.json')));
                }));

        it('includes pipeline- and job-level annotations',
            () => parser(loadData('pipeline-and-job-annotations.yaml'))
                .then((data) => {
                    assert.deepEqual(data,
                        JSON.parse(loadData('pipeline-and-job-annotations.json')));
                }));

        it('job-level annotations override shared-level annotations',
            () => parser(loadData('shared-job-annotations.yaml'))
                .then((data) => {
                    assert.deepEqual(data,
                        JSON.parse(loadData('shared-job-annotations.json')));
                }));

        it('job-level sourcePaths override shared-level sourcePaths',
            () => parser(loadData('pipeline-with-sourcePaths.yaml'))
                .then((data) => {
                    assert.deepEqual(data,
                        JSON.parse(loadData('pipeline-with-sourcePaths.json')));
                }));

        it('flattens when sourcePaths are string',
            () => parser(loadData('pipeline-with-sourcePaths-string.yaml'))
                .then((data) => {
                    assert.deepEqual(data,
                        JSON.parse(loadData('pipeline-with-sourcePaths-string.json')));
                }));

        it('flattens blockedBy', () => parser(loadData('pipeline-with-blocked-by.yaml'))
            .then((data) => {
                assert.deepEqual(data,
                    JSON.parse(loadData('pipeline-with-blocked-by.json')));
            }));

        it('flattens freezeWindows', () => parser(loadData('pipeline-with-freeze-windows.yaml'))
            .then((data) => {
                assert.deepEqual(data,
                    JSON.parse(loadData('pipeline-with-freeze-windows.json')));
            }));

        it('includes scm URLs', () => parser(loadData('pipeline-with-childPipelines.yaml'))
            .then((data) => {
                assert.deepEqual(data,
                    JSON.parse(loadData('pipeline-with-childPipelines.json')));
            }));

        describe('templates', () => {
            const templateFactoryMock = {
                getTemplate: sinon.stub()
            };
            let firstTemplate;
            let secondTemplate;
            let namespaceTemplate;
            let defaultTemplate;
            let imagesTemplate;
            let restrictedjobTemplate;

            beforeEach(() => {
                firstTemplate = JSON.parse(loadData('template.json'));
                secondTemplate = JSON.parse(loadData('template-2.json'));
                namespaceTemplate = JSON.parse(loadData('templateWithNamespace.json'));
                defaultTemplate = JSON.parse(loadData('templateWithDefaultNamespace.json'));
                imagesTemplate = JSON.parse(loadData('templateWithImages.json'));
                restrictedjobTemplate = JSON.parse(loadData('templateWithRestrictedJobName.json'));
                templateFactoryMock.getTemplate.withArgs('mytemplate@1.2.3')
                    .resolves(firstTemplate);
                templateFactoryMock.getTemplate.withArgs('yourtemplate@2')
                    .resolves(secondTemplate);
                templateFactoryMock.getTemplate.withArgs('mynamespace/mytemplate@1.2.3')
                    .resolves(namespaceTemplate);
                templateFactoryMock.getTemplate.withArgs('ImagesTestNamespace/imagestemplate@2')
                    .resolves(imagesTemplate);
                templateFactoryMock.getTemplate.withArgs('restrictedjob@1')
                    .resolves(restrictedjobTemplate);
            });

            it('flattens templates successfully',
                () => parser(loadData('basic-job-with-template.yaml'), templateFactoryMock)
                    .then(data => assert.deepEqual(
                        data, JSON.parse(loadData('basic-job-with-template.json'))
                    )));

            it('flattens templates successfully when template namespace exists', () => {
                templateFactoryMock.getTemplate.withArgs('yourtemplate@2')
                    .resolves(defaultTemplate);

                return parser(loadData('basic-job-with-template-with-namespace.yaml'),
                    templateFactoryMock)
                    .then(data => assert.deepEqual(
                        data, JSON.parse(loadData('basic-job-with-template-with-namespace.json'))
                    ));
            });

            it('flattens templates with wrapped steps ',
                () => parser(
                    loadData('basic-job-with-template-wrapped-steps.yaml'),
                    templateFactoryMock
                ).then(data => assert.deepEqual(
                    data, JSON.parse(loadData('basic-job-with-template-wrapped-steps.json'))
                )));

            it('flattens templates with job steps ',
                () => parser(
                    loadData('basic-job-with-template-override-steps.yaml'),
                    templateFactoryMock
                ).then(data => assert.deepEqual(
                    data, JSON.parse(loadData('basic-job-with-template-override-steps.json'))
                )));

            it('template-teardown is merged into steps', () => {
                templateFactoryMock.getTemplate = sinon.stub().resolves(
                    JSON.parse(loadData('template-with-teardown.json'))
                );

                return parser(
                    loadData('basic-job-with-template-override-steps.yaml'), templateFactoryMock
                )
                    .then(data => assert.deepEqual(data, JSON.parse(loadData(
                        'basic-job-with-template-override-steps-template-teardown.json'
                    ))));
            });

            it('user-teardown overrides template-teardown', () => {
                templateFactoryMock.getTemplate = sinon.stub().resolves(
                    JSON.parse(loadData('template-with-teardown.json'))
                );

                return parser(loadData(
                    'basic-job-with-template-override-steps-teardown.yaml'
                ), templateFactoryMock)
                    .then(data => assert.deepEqual(data, JSON.parse(loadData(
                        'basic-job-with-template-override-steps-teardown.json'
                    ))));
            });

            it('returns errors if flattens templates with job has duplicate steps',
                () => parser(
                    loadData('basic-job-with-template-duplicate-steps.yaml'),
                    templateFactoryMock
                ).then((data) => {
                    assert.strictEqual(data.jobs.main[0].commands[0].name,
                        'config-parse-error');
                    assert.match(data.jobs.main[0].commands[0].command,
                        /Error:.*main has duplicate step: preinstall,.* pretest/);
                    assert.match(data.errors[0],
                        /Error:.*main has duplicate step: preinstall,.* pretest/);
                }));

            it('flattens templates with images',
                () => parser(loadData('basic-job-with-images.yaml'), templateFactoryMock)
                    .then(data => assert.deepEqual(
                        data, JSON.parse(loadData('basic-job-with-images.json'))
                    )));

            it('returns error if template does not exist', () => {
                templateFactoryMock.getTemplate.withArgs('mytemplate@1.2.3').resolves(null);

                return parser(loadData('basic-job-with-template.yaml'), templateFactoryMock)
                    .then((data) => {
                        assert.match(data.jobs.main[0].commands[0].command,
                            /Template mytemplate@1.2.3 does not exist/);
                        assert.match(data.errors[0],
                            /Template mytemplate@1.2.3 does not exist/);
                    });
            });
        });
    });

    describe('functional', () => {
        const templateFactoryMock = {
            getTemplate: sinon.stub().resolves(JSON.parse(loadData('template.json')))
        };
        const buildClusterFactoryMock = {
            list: sinon.stub().resolves([{
                name: 'test',
                description: 'Testing out the buildclusters API',
                scmContext: 'github:github.com',
                scmOrganizations: [
                    'screwdriver-cd-test'
                ],
                isActive: true,
                managedByScrewdriver: false,
                maintainer: 'foo@bar.com',
                weightage: 100
            }])
        };
        const triggerFactory = {
            getDestFromSrc: sinon.stub().resolves([]),
            getSrcFromDest: sinon.stub().resolves([])
        };

        it('returns an error if not enough steps',
            () => parser(
                loadData('not-enough-commands.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.match(data.jobs.main[0].commands[0].command,
                    /"jobs.main.steps" must contain at least 1 items/);
            }));

        it('returns an error if too many environment variables',
            () => parser(
                loadData('too-many-environment.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.match(data.jobs.main[0].commands[0].command,
                    /"environment" can only have 100 environment/);
            }));

        it('do not count SD_TEMPLATE variables for max environment variables',
            () => parser(
                loadData('environment-with-SD-variable.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.notMatch(data.jobs.main[0].commands[0].command,
                    /"environment" can only have 100 environment/);
            }));

        it('returns an error if too many environment + matrix variables',
            () => parser(
                loadData('too-many-matrix.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.match(data.jobs.main[0].commands[0].command,
                    /"environment" and "matrix" can only have a combined/);
            }));

        it('returns an error if matrix is too big',
            () => parser(
                loadData('too-big-matrix.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.match(data.jobs.main[0].commands[0].command,
                    /Job "main": "matrix" cannot contain >25 perm/);
            }));

        it('returns an error if using restricted step names',
            () => parser(
                loadData('restricted-step-name.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.match(data.jobs.main[0].commands[0].command,
                    /Job "main": Step "sd-setup": cannot use a restricted prefix "sd-"/);
            }));

        it('returns an error if using restricted job names',
            () => parser(
                loadData('restricted-job-name.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.match(data.jobs.main[0].commands[0].command,
                    /Job "pr-15": cannot use a restricted prefix "pr-"/);
            }));

        it('reads annotations on the pipeline-level',
            () => parser(
                loadData('pipeline-annotations.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.deepEqual(data, JSON.parse(loadData('pipeline-annotations.json')));
            }));

        it('reads cache on the pipeline-level',
            () => parser(
                loadData('pipeline-cache.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.deepEqual(data, JSON.parse(loadData('pipeline-cache.json')));
            }));

        it('returns an error if job specified in cache config does not exist',
            () => parser(
                loadData('pipeline-cache-nonexist-job.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.deepEqual(data, JSON.parse(
                    loadData('pipeline-cache-nonexist-job.json')
                ));
            }));

        it('reads cache false on the job',
            () => parser(
                loadData('pipeline-cache-false-job.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.deepEqual(data, JSON.parse(
                    loadData('pipeline-cache-false-job.json')
                ));
            }));

        it('ignore cache false on the job when the cache config does not exist',
            () => parser(
                loadData('pipeline-cache-false-nonexist-job.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.deepEqual(data, JSON.parse(
                    loadData('pipeline-cache-false-nonexist-job.json')
                ));
            }));

        it('validates build cluster',
            () => parser(
                loadData('build-cluster.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.deepEqual(data, JSON.parse(loadData('build-cluster.json')));
            }));

        it('returns an error if build cluster does not exist',
            () => parser(
                loadData('bad-build-cluster.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.deepEqual(data, JSON.parse(
                    loadData('bad-build-cluster.json')
                ));
            }));

        it('allows a description key',
            () => parser(
                loadData('basic-job-with-description.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.isDefined(data.jobs.main[0].description);
                assert.equal(data.jobs.main[0].description,
                    'This is a description');
            }));

        it('returns an error if workflowGraph has cycle',
            () => parser(
                loadData('pipeline-with-requires-cycle.yaml'),
                templateFactoryMock,
                buildClusterFactoryMock,
                triggerFactory,
                pipelineId
            ).then((data) => {
                assert.match(data.jobs.main[0].commands[0].command,
                    /Jobs: should not have circular dependency in jobs/);
            }));
    });

    describe('warnAnnotations', () => {
        it('warning it is not pipeline-level annotation',
            () => parser(loadData('warn-pipeline-level-annotation.yaml'))
                .then((data) => {
                    /* eslint-disable max-len */
                    assert.match(data.warnAnnotations[0],
                        /screwdriver.cd\/ram is not an annotation that is reserved for Pipeline-Level/);
                    /* eslint-enable max-len */
                }));
        it('warning it is not job-level annotation',
            () => parser(loadData('warn-job-level-annotation.yaml'))
                .then((data) => {
                    /* eslint-disable max-len */
                    assert.match(data.warnAnnotations[0],
                        /screwdriver.cd\/(chainPR|restrictPR) is not an annotation that is reserved for Job-Level/);
                    assert.match(data.warnAnnotations[1],
                        /screwdriver.cd\/(chainPR|restrictPR) is not an annotation that is reserved for Job-Level/);
                    /* eslint-enable max-len */
                }));
    });

    describe('permutation', () => {
        it('generates complex permutations and expands image',
            () => parser(loadData('node-module.yaml'))
                .then((data) => {
                    assert.deepEqual(data, JSON.parse(loadData('node-module.json')));
                }));

        it('generates correct jobs',
            () => parser(loadData('pipeline-with-requires.yaml'))
                .then((data) => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-with-requires.json')));
                }));

        it('generates correct nodes with external pipeline',
            () => parser(loadData('pipeline-with-requires-external.yaml'))
                .then((data) => {
                    assert.deepEqual(data,
                        JSON.parse(loadData('pipeline-with-requires-external.json')));
                }));
    });
});

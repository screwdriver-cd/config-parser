'use strict';

const { assert } = require('chai');
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const { parsePipelineTemplate, parsePipelineYaml: parser, validatePipelineTemplate } = require('..');
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
    let templateFactoryMock;

    beforeEach(() => {
        templateFactoryMock = {
            getTemplate: sinon.stub().resolves(JSON.parse(loadData('template.json'))),
            getFullNameAndVersion: sinon.stub().returns({ isVersion: false, isTag: false })
        };
    });

    describe('parse pipeline yaml', () => {
        const pipelineTemplateVersionFactoryMock = {
            getWithMetadata: sinon.stub().resolves(JSON.parse(loadData('pipeline-template.json')))
        };
        const pipelineTemplateTagFactoryMock = {
            get: sinon.stub().resolves(null)
        };
        const triggerFactory = {
            getDestFromSrc: sinon.stub().resolves([]),
            getSrcFromDest: sinon.stub().resolves([])
        };

        describe('yaml parser', () => {
            it('returns an error if yaml does not exist', () => {
                const YAMLMISSING = /screwdriver.yaml does not exist/;

                return parser({ yaml: '' }).then(data => {
                    assert.deepEqual(data.workflowGraph, {
                        nodes: [{ name: '~pr' }, { name: '~commit' }, { name: 'main' }, { name: '~pr:/.*/' }],
                        edges: [
                            { src: '~pr', dest: 'main' },
                            { src: '~commit', dest: 'main' },
                            { src: '~pr:/.*/', dest: 'main' }
                        ]
                    });
                    assert.strictEqual(data.jobs.main[0].image, 'node:18');
                    assert.deepEqual(data.jobs.main[0].secrets, []);
                    assert.deepEqual(data.jobs.main[0].environment, {});
                    assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                    assert.match(data.jobs.main[0].commands[0].command, YAMLMISSING);
                    assert.match(data.errors[0], YAMLMISSING);
                });
            });

            it('returns an error if unparsable yaml', () =>
                parser({ yaml: 'foo: :' }).then(data => {
                    assert.strictEqual(data.jobs.main[0].image, 'node:18');
                    assert.deepEqual(data.jobs.main[0].secrets, []);
                    assert.deepEqual(data.jobs.main[0].environment, {});
                    assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                    assert.match(data.jobs.main[0].commands[0].command, /YAMLException:/);
                    assert.match(data.errors[0], /YAMLException:/);
                }));

            it('returns an error if job has duplicate steps', () =>
                parser({ yaml: loadData('basic-job-with-duplicate-steps.yaml') }).then(data => {
                    assert.strictEqual(data.jobs.main[0].image, 'node:18');
                    assert.deepEqual(data.jobs.main[0].secrets, []);
                    assert.deepEqual(data.jobs.main[0].environment, {});
                    assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                    assert.match(data.jobs.main[0].commands[0].command, /Error:.*main has duplicate step: publish/);
                    assert.match(data.errors[0], /Error:.*main has duplicate step: publish/);
                }));

            it('does not return an error if job has no step names', () =>
                parser({ yaml: loadData('basic-job-with-no-step-names.yaml'), triggerFactory }).then(data => {
                    assert.strictEqual(data.jobs.main[0].image, 'node:18');
                    assert.deepEqual(data.jobs.main[0].secrets, []);
                    assert.deepEqual(data.jobs.main[0].environment, {});
                    assert.notOk(data.errors);
                }));

            it('returns an error if multiple documents without hint', () =>
                parser({ yaml: 'foo: bar\n---\nfoo: baz' }).then(data => {
                    assert.strictEqual(data.jobs.main[0].image, 'node:18');
                    assert.deepEqual(data.jobs.main[0].secrets, []);
                    assert.deepEqual(data.jobs.main[0].environment, {});
                    assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                    assert.match(data.jobs.main[0].commands[0].command, /YAMLException:.*ambigious/);
                    assert.match(data.errors[0], /YAMLException:.*ambigious/);
                }));

            it('picks the document with version hint', () =>
                parser({ yaml: 'jobs: {}\n---\nversion: 4' }).then(data => {
                    assert.strictEqual(data.jobs.main[0].image, 'node:18');
                    assert.deepEqual(data.jobs.main[0].secrets, []);
                    assert.deepEqual(data.jobs.main[0].environment, {});
                    assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                    assert.match(data.errors[0], 'ValidationError: "jobs" is required');
                }));
        });

        describe('structure validation', () => {
            describe('overall config', () => {
                it('returns an error if missing jobs', () =>
                    parser({ yaml: 'foo: bar' }).then(data => {
                        assert.match(data.jobs.main[0].commands[0].command, /"jobs" is required/);
                        assert.match(data.errors[0], /"jobs" is required/);
                    }));
            });

            describe('jobs', () => {
                it('does not return error if missing main job for new config', () =>
                    parser({ yaml: loadData('missing-main-job-with-requires.yaml'), triggerFactory }).then(data => {
                        assert.notOk(data.errors);
                    }));

                it('returns an error if bad image name', () =>
                    parser({ yaml: loadData('bad-job-with-image.yaml') }).then(data => {
                        assert.match(
                            data.errors[0],
                            /ValidationError: "jobs.main.image" with value "node:\(12\)" fails to match the required pattern:/
                        );
                    }));
            });

            describe('steps', () => {
                it('converts steps to the commands format successfully', () =>
                    parser({ yaml: loadData('steps.yaml'), triggerFactory }).then(data => {
                        assert.deepEqual(data, JSON.parse(loadData('steps.json')));
                    }));

                it('returns an error if not bad named steps', () =>
                    parser({ yaml: loadData('bad-step-name.yaml') }).then(data => {
                        assert.match(
                            data.jobs.main[0].commands[0].command,
                            /.foo bar" only supports the following characters A-Z,a-z,0-9,-,_';/
                        );
                    }));

                it('returns an error if teardown step is not at the end', () =>
                    parser({ yaml: loadData('bad-step-teardown.yaml') }).then(data => {
                        assert.match(data.errors[0], /User teardown steps need to be at the end/);
                    }));
            });

            describe('environment', () => {
                it('returns an error if bad environment name', () =>
                    parser({ yaml: loadData('bad-environment-name.yaml') }).then(data => {
                        assert.match(
                            data.jobs.main[0].commands[0].command,
                            /"jobs.main.environment.foo bar" only supports uppercase letters,/
                        );
                    }));
            });

            describe('matrix', () => {
                it('returns an error if bad matrix name', () =>
                    parser({ yaml: loadData('bad-matrix-name.yaml') }).then(data => {
                        assert.match(
                            data.jobs.main[0].commands[0].command,
                            /"jobs.main.matrix.foo bar" only supports uppercase letters,/
                        );
                    }));
            });

            describe('childPipelines', () => {
                it('returns an error if bad childPipelines', () =>
                    parser({ yaml: loadData('bad-external-scm.yaml') }).then(data => {
                        assert.match(
                            data.jobs.main[0].commands[0].command,
                            /"fakeScmUrl" fails to match the required pattern:/
                        );
                    }));
            });

            describe('stages', () => {
                it('returns a yaml with stages in correct format when setup and teardown jobs are explicitly defined', () =>
                    parser({
                        yaml: loadData('pipeline-with-stages-and-setup-teardown-jobs-explicit.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineId
                    }).then(data => {
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('pipeline-with-stages-and-setup-teardown-jobs-explicit.json'))
                        );
                    }));

                it('returns a yaml with stages in correct format when setup and teardown jobs are explicitly defined', () =>
                    parser({
                        yaml: loadData('pipeline-with-stages-and-teardown-job-explicit.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineId
                    }).then(data => {
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('pipeline-with-stages-and-teardown-job-explicit.json'))
                        );
                    }));

                it('returns a yaml with stages in correct format when setup and teardown jobs are implicitly created', () =>
                    parser({
                        yaml: loadData('pipeline-with-stages-and-setup-teardown-jobs-implicit.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineId
                    }).then(data => {
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('pipeline-with-stages-and-setup-teardown-jobs-implicit.json'))
                        );
                    }));

                it('returns a yaml with sourcePaths set in stages', () =>
                    parser({
                        yaml: loadData('pipeline-with-stages-and-sourcePaths.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineId
                    }).then(data => {
                        assert.deepEqual(data, JSON.parse(loadData('pipeline-with-stages-and-sourcePaths.json')));
                    }));

                it('returns an error if bad stages', () =>
                    parser({ yaml: loadData('bad-stages.yaml'), triggerFactory, pipelineId }).then(data => {
                        assert.match(
                            data.jobs.main[0].commands[0].command,
                            /"stages.description" must be of type object./
                        );
                    }));

                it('returns an error if duplicate job in stages', () =>
                    parser({
                        yaml: loadData('bad-stages-duplicate-job.yaml'),
                        triggerFactory,
                        pipelineId,
                        templateFactory: templateFactoryMock
                    }).then(data => {
                        assert.match(data.errors[0], /Error: Cannot have duplicate job in multiple stages: main\n/);
                    }));

                it('returns an error if nonexistent job in stages', () =>
                    parser({
                        yaml: loadData('bad-stages-nonexistent-job.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineId
                    }).then(data => {
                        assert.match(data.errors[0], /Error: Cannot have nonexistent job in stages: publish,deploy\n/);
                    }));

                it('returns an error if a job within a stage is triggered by jobs that are not within the same stage', () =>
                    parser({
                        yaml: loadData('pipeline-with-stages-and-invalid-triggers.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineId
                    }).then(data => {
                        assert.match(
                            data.errors[0],
                            /Error: main job has invalid requires: baz. Triggers must be jobs from canary stage./
                        );
                    }));

                it('returns an error if sourcePaths is set for a job defined in stage.', () =>
                    parser({
                        yaml: loadData('pipeline-with-stages-and-invalid-sourcePaths.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineId
                    }).then(data => {
                        assert.match(data.errors[0], /Error: Job foo in stage cannot have sourcePaths defined./);
                    }));
            });

            describe('subscribe', () => {
                it('fetches subscribe from the config and adds to parsed doc', () =>
                    parser({ yaml: loadData('pipeline-with-subscribed-scms.yaml'), triggerFactory }).then(data => {
                        assert.deepEqual(data, JSON.parse(loadData('pipeline-with-subscribed-scms.json')));
                    }));
            });
        });

        describe('flatten', () => {
            it('replaces steps, matrix, image, but merges environment', () =>
                parser({ yaml: loadData('basic-shared-project.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('basic-shared-project.json')));
                }));

            it('replaces settings if empty object', () =>
                parser({ yaml: loadData('basic-shared-project-empty-settings.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('basic-shared-project-empty-settings.json')));
                }));

            it('flattens complex environments', () =>
                parser({ yaml: loadData('complex-environment.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('complex-environment.json')));
                }));

            it('flattens shared annotations to each job', () =>
                parser({ yaml: loadData('shared-annotations.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('shared-annotations.json')));
                }));

            it('includes pipeline- and job-level annotations', () =>
                parser({ yaml: loadData('pipeline-and-job-annotations.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-and-job-annotations.json')));
                }));

            it('job-level annotations override shared-level annotations', () =>
                parser({ yaml: loadData('shared-job-annotations.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('shared-job-annotations.json')));
                }));

            it('returns error if job has admin annotations', () =>
                parser({ yaml: loadData('admin-job-annotations.yaml'), triggerFactory }).then(data => {
                    assert.match(
                        data.errors[0],
                        /Error: Annotations starting with screwdriver.cd\/admin are reserved for system use only/
                    );
                }));

            it('job-level sourcePaths override shared-level sourcePaths', () =>
                parser({ yaml: loadData('pipeline-with-sourcePaths.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-with-sourcePaths.json')));
                }));

            it('flattens when sourcePaths are string', () =>
                parser({ yaml: loadData('pipeline-with-sourcePaths-string.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-with-sourcePaths-string.json')));
                }));

            it('flattens blockedBy', () =>
                parser({ yaml: loadData('pipeline-with-blocked-by.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-with-blocked-by.json')));
                }));

            it('flattens freezeWindows', () =>
                parser({ yaml: loadData('pipeline-with-freeze-windows.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-with-freeze-windows.json')));
                }));

            it('flattens provider', () =>
                parser({ yaml: loadData('pipeline-with-provider.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-with-provider.json')));
                }));

            it('includes scm URLs', () =>
                parser({ yaml: loadData('pipeline-with-childPipelines.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-with-childPipelines.json')));
                }));

            it('include job parameters', () =>
                parser({
                    yaml: loadData('basic-job-with-parameters-and-without-template.yaml'),
                    triggerFactory
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('basic-job-with-parameters-and-without-template.json')));
                }));

            describe('templates', () => {
                let firstTemplate;
                let secondTemplate;
                let namespaceTemplate;
                let defaultTemplate;
                let imagesTemplate;
                let restrictedjobTemplate;
                let lockedStepsTemplate;
                let jobParametersTemplate;
                let providerTemplate;
                let jobWithRequiresTemplate;
                let jobWithCacheTemplate1;
                let jobWithCacheTemplate2;

                beforeEach(() => {
                    firstTemplate = JSON.parse(loadData('template.json'));
                    secondTemplate = JSON.parse(loadData('template-2.json'));
                    namespaceTemplate = JSON.parse(loadData('templateWithNamespace.json'));
                    defaultTemplate = JSON.parse(loadData('templateWithDefaultNamespace.json'));
                    imagesTemplate = JSON.parse(loadData('templateWithImages.json'));
                    restrictedjobTemplate = JSON.parse(loadData('templateWithRestrictedJobName.json'));
                    lockedStepsTemplate = JSON.parse(loadData('templateWithLockedSteps.json'));
                    jobParametersTemplate = JSON.parse(loadData('templateWithParameters.json'));
                    providerTemplate = JSON.parse(loadData('templateWithProvider.json'));
                    jobWithRequiresTemplate = JSON.parse(loadData('templateWithRequires.json'));
                    jobWithCacheTemplate1 = JSON.parse(loadData('templateWithCache.json'));
                    jobWithCacheTemplate2 = JSON.parse(loadData('templateWithCache.json'));
                    templateFactoryMock.getFullNameAndVersion.returns({ isVersion: true });
                    templateFactoryMock.getTemplate.withArgs('mytemplate@1.2.3').resolves(firstTemplate);
                    templateFactoryMock.getTemplate.withArgs('yourtemplate@2').resolves(secondTemplate);
                    templateFactoryMock.getTemplate
                        .withArgs('mynamespace/mytemplate@1.2.3')
                        .resolves(namespaceTemplate);
                    templateFactoryMock.getTemplate
                        .withArgs('ImagesTestNamespace/imagestemplate@2')
                        .resolves(imagesTemplate);
                    templateFactoryMock.getTemplate.withArgs('restrictedjob@1').resolves(restrictedjobTemplate);
                    templateFactoryMock.getTemplate.withArgs('lockedSteps@1').resolves(lockedStepsTemplate);
                    templateFactoryMock.getTemplate
                        .withArgs('JobParametersTestNamespace/jobparameterstemplate@2')
                        .resolves(jobParametersTemplate);
                    templateFactoryMock.getTemplate
                        .withArgs('JobProviderTestNamespace/jobprovidertemplate@2')
                        .resolves(providerTemplate);
                    templateFactoryMock.getTemplate
                        .withArgs('JobTestNamespace/jobrequirestemplate@2')
                        .resolves(jobWithRequiresTemplate);
                    // Since the resolved values are the same object, their properties can be overwritten during other parsing.
                    // We need to separate that resolved values in tests.
                    templateFactoryMock.getTemplate
                        .withArgs('TemplateCacheTestNamespace/cachetemplate@1')
                        .resolves(jobWithCacheTemplate1);
                    templateFactoryMock.getTemplate
                        .withArgs('TemplateCacheTestNamespace/cachetemplate@2')
                        .resolves(jobWithCacheTemplate2);
                });

                it('flattens templates successfully', () =>
                    parser({
                        yaml: loadData('basic-job-with-template.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data => assert.deepEqual(data, JSON.parse(loadData('basic-job-with-template.json')))));

                it('flattens templates successfully when template namespace exists', () => {
                    templateFactoryMock.getTemplate.withArgs('yourtemplate@2').resolves(defaultTemplate);

                    return parser({
                        yaml: loadData('basic-job-with-template-with-namespace.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data =>
                        assert.deepEqual(data, JSON.parse(loadData('basic-job-with-template-with-namespace.json')))
                    );
                });

                it('flattens templates with wrapped steps ', () =>
                    parser({
                        yaml: loadData('basic-job-with-template-wrapped-steps.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data =>
                        assert.deepEqual(data, JSON.parse(loadData('basic-job-with-template-wrapped-steps.json')))
                    ));

                it('flattens templates with job steps ', () =>
                    parser({
                        yaml: loadData('basic-job-with-template-override-steps.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data =>
                        assert.deepEqual(data, JSON.parse(loadData('basic-job-with-template-override-steps.json')))
                    ));

                it('flattens templates with shared and job steps ', () =>
                    parser({
                        yaml: loadData('basic-job-with-shared-and-template-override-steps.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data =>
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('basic-job-with-shared-and-template-override-steps.json'))
                        )
                    ));

                it('flattens templates with order', () =>
                    parser({
                        yaml: loadData('basic-job-with-order.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data => assert.deepEqual(data, JSON.parse(loadData('basic-job-with-order.json')))));

                it('flattens with warnings with order and no template', () =>
                    parser({ yaml: loadData('pipeline-with-order-no-template.yaml'), triggerFactory }).then(data => {
                        assert.deepEqual(data, JSON.parse(loadData('pipeline-with-order-no-template.json')));
                    }));

                it('flattens templates with locked steps', () =>
                    parser({
                        yaml: loadData('basic-job-with-template-locked-steps.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data =>
                        assert.deepEqual(data, JSON.parse(loadData('basic-job-with-template-locked-steps.json')))
                    ));

                it('flattens templates with order and locked steps', () =>
                    parser({
                        yaml: loadData('basic-job-with-template-order-and-locked-steps.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data =>
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('basic-job-with-template-order-and-locked-steps.json'))
                        )
                    ));

                it('returns errors if order is missing locked steps', () =>
                    parser({
                        yaml: loadData('basic-job-with-template-missing-locked-steps.yaml'),
                        templateFactory: templateFactoryMock
                    }).then(data => {
                        assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                        assert.match(
                            data.jobs.main[0].commands[0].command,
                            // eslint-disable-next-line max-len
                            /Error: Order must contain template lockedSteps@1 locked steps: init,install'/
                        );
                        assert.match(
                            data.errors[0],
                            // eslint-disable-next-line max-len
                            'Error: Order must contain template lockedSteps@1 locked steps: init,install'
                        );
                    }));

                it('flattens templates with order and teardown', () =>
                    parser({
                        yaml: loadData('basic-job-with-order-and-teardown.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data =>
                        assert.deepEqual(data, JSON.parse(loadData('basic-job-with-order-and-teardown.json')))
                    ));

                it('flattens templates with warnings', () =>
                    parser({
                        yaml: loadData('basic-job-with-warnings.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data => assert.deepEqual(data, JSON.parse(loadData('basic-job-with-warnings.json')))));

                it('template-teardown is merged into steps', () => {
                    templateFactoryMock.getTemplate = sinon
                        .stub()
                        .resolves(JSON.parse(loadData('template-with-teardown.json')));

                    return parser({
                        yaml: loadData('basic-job-with-template-override-steps.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data =>
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('basic-job-with-template-override-steps-template-teardown.json'))
                        )
                    );
                });

                it('user-teardown overrides template-teardown', () => {
                    templateFactoryMock.getTemplate = sinon
                        .stub()
                        .resolves(JSON.parse(loadData('template-with-teardown.json')));

                    return parser({
                        yaml: loadData('basic-job-with-template-override-steps-teardown.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data =>
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('basic-job-with-template-override-steps-teardown.json'))
                        )
                    );
                });

                it('returns errors if flattens templates with job has duplicate steps', () =>
                    parser({
                        yaml: loadData('basic-job-with-template-duplicate-steps.yaml'),
                        templateFactory: templateFactoryMock
                    }).then(data => {
                        assert.strictEqual(data.jobs.main[0].commands[0].name, 'config-parse-error');
                        assert.match(
                            data.jobs.main[0].commands[0].command,
                            /Error:.*main has duplicate step: preinstall,.* pretest/
                        );
                        assert.match(data.errors[0], /Error:.*main has duplicate step: preinstall,.* pretest/);
                    }));

                it('flattens templates with images', () =>
                    parser({
                        yaml: loadData('basic-job-with-images.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data => {
                        assert.deepEqual(data, JSON.parse(loadData('basic-job-with-images.json')));
                    }));

                it('returns error if template does not exist', () => {
                    templateFactoryMock.getTemplate.withArgs('mytemplate@1.2.3').resolves(null);

                    return parser({
                        yaml: loadData('basic-job-with-template.yaml'),
                        templateFactory: templateFactoryMock
                    }).then(data => {
                        assert.match(data.jobs.main[0].commands[0].command, /Template mytemplate@1.2.3 does not exist/);
                        assert.match(data.errors[0], /Template mytemplate@1.2.3 does not exist/);
                    });
                });

                it('flattens job parameters with templates not containing parameters', () =>
                    parser({
                        yaml: loadData('basic-job-with-parameters-and-template-without-parameters.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data => {
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('basic-job-with-parameters-and-template-without-parameters.json'))
                        );
                    }));

                it('flattens job parameters with templates containing parameters', () =>
                    parser({
                        yaml: loadData('basic-job-with-parameters-and-template-with-parameters.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data => {
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('basic-job-with-parameters-and-template-with-parameters.json'))
                        );
                    }));

                it('flattens cache config with templates containing parsed cache setting', () =>
                    parser({
                        yaml: loadData('basic-job-and-template-with-cache.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data => {
                        assert.deepEqual(data, JSON.parse(loadData('basic-job-and-template-with-cache.json')));
                    }));

                it('flattens templates with provider', () =>
                    parser({
                        yaml: loadData('basic-job-with-provider.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory
                    }).then(data => {
                        assert.deepEqual(data, JSON.parse(loadData('basic-job-with-provider.json')));
                    }));
            });

            describe('pipeline templates', () => {
                const templateTagMock = {
                    version: '1.0.0'
                };
                let defaultPipelineTemplate;

                beforeEach(() => {
                    defaultPipelineTemplate = JSON.parse(loadData('pipeline-template.json'));
                    pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(defaultPipelineTemplate);
                    pipelineTemplateTagFactoryMock.get.resolves(templateTagMock);
                });

                it('flattens basic pipeline template successfully', () =>
                    parser({
                        yaml: loadData('pipeline-template-basic.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineTemplateTagFactory: pipelineTemplateTagFactoryMock,
                        pipelineTemplateVersionFactory: pipelineTemplateVersionFactoryMock
                    }).then(data => {
                        assert.deepEqual(data, JSON.parse(loadData('pipeline-template-basic-result.json')));
                    }));

                it('flattens pipeline template with shared setting', () => {
                    const pipelineTemplateMock = JSON.parse(loadData('pipeline-template-with-shared-setting.json'));

                    pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(pipelineTemplateMock);

                    return parser({
                        yaml: loadData('pipeline-template-with-shared-setting.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineTemplateTagFactory: pipelineTemplateTagFactoryMock,
                        pipelineTemplateVersionFactory: pipelineTemplateVersionFactoryMock
                    }).then(data => {
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('pipeline-template-with-shared-setting-result.json'))
                        );
                    });
                });

                it('flattens pipeline template with job template and mergeSharedSteps annotation', () => {
                    const pipelineTemplateMock = JSON.parse(
                        loadData('pipeline-template-with-mergeSharedSteps-annotation.json')
                    );

                    pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(pipelineTemplateMock);
                    templateFactoryMock.getTemplate.resolves(JSON.parse(loadData('template.json')));
                    templateFactoryMock.getFullNameAndVersion.returns({ isVersion: true });

                    return parser({
                        yaml: loadData('pipeline-template-with-mergeSharedSteps-annotation.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineTemplateTagFactory: pipelineTemplateTagFactoryMock,
                        pipelineTemplateVersionFactory: pipelineTemplateVersionFactoryMock
                    }).then(data => {
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('pipeline-template-with-mergeSharedSteps-annotation-result.json'))
                        );
                    });
                });

                it('flattens pipeline template with user defined pipeline level setting', () => {
                    const pipelineTemplateMock = JSON.parse(loadData('pipeline-template-with-user-setting.json'));

                    pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(pipelineTemplateMock);

                    return parser({
                        yaml: loadData('pipeline-template-with-user-setting.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineTemplateTagFactory: pipelineTemplateTagFactoryMock,
                        pipelineTemplateVersionFactory: pipelineTemplateVersionFactoryMock
                    }).then(data => {
                        assert.deepEqual(data, JSON.parse(loadData('pipeline-template-with-user-setting-result.json')));
                    });
                });

                it('flattens pipeline template with template defined pipeline level setting', () => {
                    const pipelineTemplateMock = JSON.parse(loadData('pipeline-template-with-template-setting.json'));

                    pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(pipelineTemplateMock);

                    return parser({
                        yaml: loadData('pipeline-template-with-template-setting.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineTemplateTagFactory: pipelineTemplateTagFactoryMock,
                        pipelineTemplateVersionFactory: pipelineTemplateVersionFactoryMock
                    }).then(data => {
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('pipeline-template-with-template-setting-result.json'))
                        );
                    });
                });

                it('flattens pipeline template with both user and template defined pipeline level setting', () => {
                    const pipelineTemplateMock = JSON.parse(loadData('pipeline-template-with-template-setting.json'));

                    pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(pipelineTemplateMock);

                    return parser({
                        yaml: loadData('pipeline-template-with-user-setting.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineTemplateTagFactory: pipelineTemplateTagFactoryMock,
                        pipelineTemplateVersionFactory: pipelineTemplateVersionFactoryMock
                    }).then(data => {
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('pipeline-template-with-pipeline-setting-result.json'))
                        );
                    });
                });

                it('flattens pipeline template with both user and template defined job settings', () => {
                    const pipelineTemplateMock = JSON.parse(loadData('pipeline-template-with-template-setting.json'));

                    pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(pipelineTemplateMock);

                    return parser({
                        yaml: loadData('pipeline-template-with-customized-job.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineTemplateTagFactory: pipelineTemplateTagFactoryMock,
                        pipelineTemplateVersionFactory: pipelineTemplateVersionFactoryMock
                    }).then(data => {
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('pipeline-template-with-customized-job-result.json'))
                        );
                    });
                });

                it('flattens pipeline template with custom user defined job', () => {
                    const pipelineTemplateMock = JSON.parse(loadData('pipeline-template-with-template-setting.json'));

                    pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(pipelineTemplateMock);

                    return parser({
                        yaml: loadData('pipeline-template-with-new-customized-job.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineTemplateTagFactory: pipelineTemplateTagFactoryMock,
                        pipelineTemplateVersionFactory: pipelineTemplateVersionFactoryMock
                    }).then(data => {
                        assert.deepEqual(
                            data,
                            JSON.parse(loadData('pipeline-template-with-new-customized-job-result.json'))
                        );
                    });
                });

                it('returns error for invalid screwdriver yaml', () =>
                    parser({
                        yaml: loadData('pipeline-template-invalid.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineTemplateTagFactory: pipelineTemplateTagFactoryMock,
                        pipelineTemplateVersionFactory: pipelineTemplateVersionFactoryMock
                    }).then(data => {
                        assert.deepEqual(
                            data.errors[0],
                            'Error: Job "main" has unsupported fields in user yaml. Can only set settings,requires,image,environment,annotations.'
                        );
                    }));

                it('returns error if pipeline template does not exist', () => {
                    pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(null);

                    return parser({
                        yaml: loadData('pipeline-template-basic.yaml'),
                        templateFactory: templateFactoryMock,
                        triggerFactory,
                        pipelineTemplateTagFactory: pipelineTemplateTagFactoryMock,
                        pipelineTemplateVersionFactory: pipelineTemplateVersionFactoryMock
                    }).then(data => {
                        assert.match(data.errors[0], 'Error: Pipeline template foo/bar@1.0.0 does not exist');
                    });
                });
            });
        });

        describe('functional', () => {
            const buildClusterFactoryMock = {
                list: sinon.stub().resolves([
                    {
                        name: 'test',
                        description: 'Testing out the buildclusters API',
                        scmContext: 'github:github.com',
                        scmOrganizations: ['screwdriver-cd-test'],
                        isActive: true,
                        managedByScrewdriver: false,
                        maintainer: 'foo@bar.com',
                        weightage: 100
                    }
                ])
            };

            it('returns an error if not enough steps', () =>
                parser({
                    yaml: loadData('not-enough-commands.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.match(
                        data.jobs.main[0].commands[0].command,
                        /"jobs.main.steps" must contain at least 1 items/
                    );
                }));

            it('returns an error if too many environment variables', () =>
                parser({
                    yaml: loadData('too-many-environment.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.match(data.jobs.main[0].commands[0].command, /"environment" can only have 100 environment/);
                }));

            it('does not count SD_TEMPLATE variables for max environment variables', () =>
                parser({
                    yaml: loadData('environment-with-SD-variable.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.notMatch(
                        data.jobs.main[0].commands[0].command,
                        /"environment" can only have 100 environment/
                    );
                }));

            it('returns an error if too many environment + matrix variables', () =>
                parser({
                    yaml: loadData('too-many-matrix.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.match(
                        data.jobs.main[0].commands[0].command,
                        /"environment" and "matrix" can only have a combined/
                    );
                }));

            it('returns an error if matrix is too big', () =>
                parser({
                    yaml: loadData('too-big-matrix.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.match(data.jobs.main[0].commands[0].command, /Job "main": "matrix" cannot contain >25 perm/);
                }));

            it('returns an error if using restricted step names', () =>
                parser({
                    yaml: loadData('restricted-step-name.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.match(
                        data.jobs.main[0].commands[0].command,
                        /Job "main": Step "sd-setup": cannot use a restricted prefix "sd-"/
                    );
                }));

            it('returns an error if using restricted job names', () =>
                parser({
                    yaml: loadData('restricted-job-name.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.match(
                        data.jobs.main[0].commands[0].command,
                        /Job "pr-15": cannot use a restricted prefix "pr-"/
                    );
                }));

            it('reads annotations on the pipeline-level', () =>
                parser({
                    yaml: loadData('pipeline-annotations.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-annotations.json')));
                }));

            it('reads cache on the pipeline-level', () =>
                parser({
                    yaml: loadData('pipeline-cache.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-cache.json')));
                }));

            it('returns an error if job specified in cache config does not exist', () =>
                parser({
                    yaml: loadData('pipeline-cache-nonexist-job.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-cache-nonexist-job.json')));
                }));

            it('reads cache false on the job', () =>
                parser({
                    yaml: loadData('pipeline-cache-false-job.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-cache-false-job.json')));
                }));

            it('ignore cache false on the job when the cache config does not exist', () =>
                parser({
                    yaml: loadData('pipeline-cache-false-nonexist-job.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-cache-false-nonexist-job.json')));
                }));

            it('validates build cluster', () =>
                parser({
                    yaml: loadData('build-cluster.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('build-cluster.json')));
                }));

            it('returns an error if build cluster does not exist', () =>
                parser({
                    yaml: loadData('bad-build-cluster.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('bad-build-cluster.json')));
                }));

            it('allows a description key', () =>
                parser({
                    yaml: loadData('basic-job-with-description.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.isDefined(data.jobs.main[0].description);
                    assert.equal(data.jobs.main[0].description, 'This is a description');
                }));

            it('returns an error if workflowGraph has cycle', () =>
                parser({
                    yaml: loadData('pipeline-with-requires-cycle.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.match(
                        data.jobs.main[0].commands[0].command,
                        /Jobs: should not have circular dependency in jobs/
                    );
                }));

            it('reads notification annotations', () =>
                parser({
                    yaml: loadData('notification-settings.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('notification-settings.json')));
                }));

            it('returns an error if wrong notification slack setting', () =>
                parser({
                    yaml: loadData('bad-notification-slack-settings.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('bad-notification-slack-settings.json')));
                }));

            it('returns an error if wrong notification email setting', () =>
                parser({
                    yaml: loadData('bad-notification-email-settings.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('bad-notification-email-settings.json')));
                }));

            it('returns a warning if wrong notification slack and email setting with flag set to false', () =>
                parser({
                    yaml: loadData('bad-notification-slack-email-settings.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId,
                    notificationsValidationErr: false
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('bad-notification-slack-email-settings-warnings.json')));
                }));

            it('returns an error if wrong notification slack and email setting', () =>
                parser({
                    yaml: loadData('bad-notification-slack-email-settings.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('bad-notification-slack-email-settings.json')));
                }));

            it('returns an error if wrong notification shared setting', () =>
                parser({
                    yaml: loadData('bad-notification-shared-settings.yaml'),
                    templateFactory: templateFactoryMock,
                    buildClusterFactory: buildClusterFactoryMock,
                    triggerFactory,
                    pipelineId
                }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('bad-notification-shared-settings.json')));
                }));
        });

        describe('warnMessages', () => {
            beforeEach(() => {
                const myTemplate = JSON.parse(loadData('template.json'));

                templateFactoryMock.getFullNameAndVersion.returns({ isVersion: false, isTag: false });
                templateFactoryMock.getTemplate.resolves(myTemplate);
            });

            it('warning it is not pipeline-level annotation', () =>
                parser({ yaml: loadData('warn-pipeline-level-annotation.yaml'), triggerFactory }).then(data => {
                    /* eslint-disable max-len */
                    assert.match(
                        data.warnMessages[0],
                        /screwdriver.cd\/ram is not an annotation that is reserved for Pipeline-Level/
                    );
                    /* eslint-enable max-len */
                }));
            it('warning it is not job-level annotation', () =>
                parser({ yaml: loadData('warn-job-level-annotation.yaml'), triggerFactory }).then(data => {
                    /* eslint-disable max-len */
                    assert.match(
                        data.warnMessages[0],
                        /screwdriver.cd\/(chainPR|restrictPR) is not an annotation that is reserved for Job-Level/
                    );
                    assert.match(
                        data.warnMessages[1],
                        /screwdriver.cd\/(chainPR|restrictPR) is not an annotation that is reserved for Job-Level/
                    );
                    /* eslint-enable max-len */
                }));
            it('warning template version is not specify in shared settings', () =>
                parser({
                    yaml: loadData('warn-shared-template-version.yaml'),
                    templateFactory: templateFactoryMock,
                    triggerFactory
                }).then(data => {
                    /* eslint-disable max-len */
                    assert.match(
                        data.warnMessages[0],
                        /foo\/bar template in shared settings should be explicitly versioned/
                    );
                    /* eslint-enable max-len */
                }));
            it('warning template version is not specify in job settings', () =>
                parser({
                    yaml: loadData('warn-job-template-version.yaml'),
                    templateFactory: templateFactoryMock,
                    triggerFactory
                }).then(data => {
                    /* eslint-disable max-len */
                    assert.match(data.warnMessages[0], /foo\/bar template in main job should be explicitly versioned/);
                    assert.match(data.warnMessages[1], /foo\/baz template in sub job should be explicitly versioned/);
                    /* eslint-enable max-len */
                }));
        });

        describe('permutation', () => {
            it('generates complex permutations and expands image', () =>
                parser({ yaml: loadData('node-module.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('node-module.json')));
                }));

            it('generates correct jobs', () =>
                parser({ yaml: loadData('pipeline-with-requires.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-with-requires.json')));
                }));

            it('generates correct nodes with external pipeline', () =>
                parser({ yaml: loadData('pipeline-with-requires-external.yaml'), triggerFactory }).then(data => {
                    assert.deepEqual(data, JSON.parse(loadData('pipeline-with-requires-external.json')));
                }));

            describe('replace image name', () => {
                it('replace correct image name', () =>
                    parser({ yaml: loadData('replace-image.yaml') }).then(data => {
                        assert.strictEqual(data.jobs.main[0].image, 'node:18');
                    }));

                it('returns an error if replace bad image name', () =>
                    parser({ yaml: loadData('bad-replace-image.yaml'), triggerFactory }).then(data => {
                        assert.match(
                            data.errors[0],
                            /ValidationError: "jobs.main.image" with value "node:\(12\)" fails to match the required pattern:/
                        );
                    }));
            });
        });
    });

    describe('parse pipeline template', () => {
        it('flattens shared setting into jobs', () =>
            parsePipelineTemplate({
                yaml: loadData('parse-pipeline-template-with-shared-setting.yaml')
            }).then(data => {
                assert.deepEqual(data, JSON.parse(loadData('parse-pipeline-template-with-shared-setting.json')));
            }));
        it('flattens shared setting and handles mergeSharedSteps annotation properly', () =>
            parsePipelineTemplate({
                yaml: loadData('parse-pipeline-template-with-mergeSharedSteps-annotation.yaml')
            }).then(data => {
                assert.deepEqual(
                    data,
                    JSON.parse(loadData('parse-pipeline-template-with-mergeSharedSteps-annotation.json'))
                );
            }));
        it('throws error if pipeline template is invalid', () =>
            parsePipelineTemplate({
                yaml: loadData('parse-pipeline-template-invalid.yaml')
            }).then(assert.fail, err => {
                assert.match(err.toString(), /[ValidationError]: "config.jobs" is required/);
            }));
    });

    describe('validate pipeline template', () => {
        it('flattens pipeline template for the validator and pulls in job template steps', () =>
            validatePipelineTemplate({
                yaml: loadData('validate-pipeline-template-with-job-template.yaml'),
                templateFactory: templateFactoryMock
            }).then(data => {
                assert.deepEqual(data, JSON.parse(loadData('validate-pipeline-template-with-job-template.json')));
            }));
        it('throws error if pipeline template is invalid', () =>
            validatePipelineTemplate({
                yaml: loadData('validate-pipeline-template-invalid.yaml'),
                templateFactory: templateFactoryMock
            }).then(assert.fail, err => {
                assert.match(err.toString(), /[ValidationError]: "config.jobs" is required/);
            }));
    });
});

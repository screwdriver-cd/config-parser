'use strict';

const Hoek = require('@hapi/hoek');
const TinyTim = require('tinytim');
const clone = require('clone');
const keymbinatorial = require('keymbinatorial');

/**
 * Permutation Phase
 *  - Generate permutations for each job
 * @method
 * @param   {Object}   validatedDoc Document that went through functional validation
 * @returns {Promise}
 */
module.exports = validatedDoc =>
    new Promise(resolve => {
        const doc = validatedDoc;

        // Generate permutations for each job
        Object.keys(doc.jobs).forEach(jobName => {
            const job = {
                annotations: Hoek.reach(doc, `jobs.${jobName}.annotations`, {
                    default: {}
                }),
                commands: Hoek.reach(doc, `jobs.${jobName}.commands`),
                environment: Hoek.reach(doc, `jobs.${jobName}.environment`, {
                    default: {}
                }),
                image: Hoek.reach(doc, `jobs.${jobName}.image`),
                secrets: Hoek.reach(doc, `jobs.${jobName}.secrets`),
                settings: Hoek.reach(doc, `jobs.${jobName}.settings`, {
                    default: {}
                })
            };

            if (doc.jobs[jobName].cache !== undefined) {
                job.cache = doc.jobs[jobName].cache;
            }

            if (doc.jobs[jobName].description !== undefined) {
                job.description = doc.jobs[jobName].description;
            }

            if (doc.jobs[jobName].templateId !== undefined) {
                job.templateId = doc.jobs[jobName].templateId;
            }

            if (doc.jobs[jobName].parameters !== undefined) {
                job.parameters = doc.jobs[jobName].parameters;
            }

            if (doc.jobs[jobName].provider !== undefined) {
                job.provider = doc.jobs[jobName].provider;
            }

            // If has the requires/blockedby/freezeWindows key, then set it
            if (doc.jobs[jobName].requires !== undefined) {
                job.requires = doc.jobs[jobName].requires;
            }
            if (doc.jobs[jobName].blockedBy !== undefined) {
                job.blockedBy = doc.jobs[jobName].blockedBy;
            }
            if (doc.jobs[jobName].freezeWindows !== undefined) {
                job.freezeWindows = doc.jobs[jobName].freezeWindows;
            }
            if (doc.jobs[jobName].blockedBySameJob !== undefined) {
                job.blockedBySameJob = doc.jobs[jobName].blockedBySameJob;
            }
            if (doc.jobs[jobName].blockedBySameJobWaitTime !== undefined) {
                job.blockedBySameJobWaitTime = doc.jobs[jobName].blockedBySameJobWaitTime;
            }

            // If doesn't have sourcePaths, then don't set it
            if (doc.jobs[jobName].sourcePaths.length > 0) {
                job.sourcePaths = doc.jobs[jobName].sourcePaths;
            }

            const matrix = Hoek.reach(doc, `jobs.${jobName}.matrix`, {
                default: {}
            });
            const tasks = [];
            const permutations = keymbinatorial(matrix);

            permutations.forEach(permutation => {
                const newTask = clone(job);
                const stringPermutation = permutation;

                // Convert all values to string
                Object.keys(permutation).forEach(varName => {
                    switch (typeof permutation[varName]) {
                        case 'object':
                        case 'number':
                        case 'boolean':
                            stringPermutation[varName] = JSON.stringify(permutation[varName]);
                            break;
                        default:
                    }
                });

                Object.assign(newTask.environment, stringPermutation);

                // Replace any {{environment-keys}} in the image name with the values
                // node:{{NODE_VERSION}} with NODE_VERSION=6 becomes node:6
                newTask.image = TinyTim.tim(newTask.image, newTask.environment);

                tasks.push(newTask);
            });

            doc.jobs[jobName] = tasks;
        });

        resolve(doc);
    });

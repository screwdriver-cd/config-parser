'use strict';

const Hoek = require('hoek');
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
module.exports = validatedDoc => (
    new Promise((resolve) => {
        const doc = validatedDoc;

        // Generate permutations for each job
        Object.keys(doc.jobs).forEach((jobName) => {
            const job = {
                image: Hoek.reach(doc, `jobs.${jobName}.image`),
                commands: Hoek.reach(doc, `jobs.${jobName}.commands`),
                secrets: Hoek.reach(doc, `jobs.${jobName}.secrets`),
                environment: Hoek.reach(doc, `jobs.${jobName}.environment`, {
                    default: {}
                })
            };
            const matrix = Hoek.reach(doc, `jobs.${jobName}.matrix`, {
                default: {}
            });
            const tasks = [];
            const permutations = keymbinatorial(matrix);

            permutations.forEach((permutation) => {
                const newTask = clone(job);
                const stringPermutation = permutation;

                // Convert all values to string
                Object.keys(permutation).forEach((varName) => {
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
    })
);

'use strict';

const Hoek = require('hoek');
const TinyTim = require('tinytim');
const clone = require('clone');
const keymbinatorial = require('keymbinatorial');

/**
 * Permutation Phase
 *  - Generate permutations for each job
 * @method
 * @param  {Object}   validatedDoc Document that went through functional validation
 * @param  {Function} callback     Function to call when done (err, doc)
 */
module.exports = (validatedDoc, callback) => {
    const doc = validatedDoc;

    // Generate permutations for each job
    Object.keys(doc.jobs).forEach((jobName) => {
        const job = {
            image: Hoek.reach(doc, `jobs.${jobName}.image`),
            steps: Hoek.reach(doc, `jobs.${jobName}.steps`),
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

            Object.assign(newTask.environment, permutation);

            // Replace any {{environment-keys}} in the image name with the values
            // node:{{NODE_VERSION}} with NODE_VERSION=6 becomes node:6
            newTask.image = TinyTim.tim(newTask.image, newTask.environment);

            tasks.push(newTask);
        });

        doc.jobs[jobName] = tasks;
    });

    callback(null, doc);
};

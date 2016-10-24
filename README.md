# Screwdriver.yaml Configuration Parser
[![Version][npm-image]][npm-url] ![Downloads][downloads-image] [![Build Status][status-image]][status-url] [![Open Issues][issues-image]][issues-url] [![Dependency Status][daviddm-image]][daviddm-url] ![License][license-image]

> Node module for validating and parsing `screwdriver.yaml` configurations

 - Validates a `screwdriver.yaml` for structural and functional specification
 - Outputs the pipeline's workflow
 - Generates a list of jobs to execute, including:
     - build permutations
     - environment variables to set
     - steps to execute
     - container image to use

## YAML

```yaml
workflow:
    - publish

shared:
    environment:
        NODE_ENV: test

jobs:
    main:
        image: node:{{NODE_VERSION}}
        matrix:
            NODE_VERSION: [4,5,6]
        steps:
            - init: npm install
            - test: npm test

    publish:
        environment:
            NODE_TAG: latest
        image: node:4
        steps:
            - bump: npm run bump
            - publish: npm publish --tag $NODE_TAG
            - tag: git push origin --tags
        secrets:
            - NPM_TOKEN
            - GIT_KEY
```

## Usage

```bash
npm install screwdriver-config-parser
```

Parse in Node.js:

```javascript
const parser = require('screwdriver-config-parser');

// Configuration (in YAML form)
parser(fs.readFileSync('screwdriver.yaml'), (err, pipeline) => {
    // Workflow for the pipeline
    // pipeline.workflow

    // All the main jobs with the steps to execute and environment variables to set
    // pipeline.jobs.main[].commands
    // pipeline.jobs.main[].environment
    // pipeline.jobs.main[].image

    // All the publish jobs with the steps to execute and environment variables to set
    // pipeline.jobs.publish[].commands
    // pipeline.jobs.publish[].environment
    // pipeline.jobs.publish[].image
});
```

Or for usage on the command line see [USAGE.md](./USAGE.md).

## Testing

```bash
npm test
```

## License

Code licensed under the BSD 3-Clause license. See LICENSE file for terms.

[npm-image]: https://img.shields.io/npm/v/screwdriver-config-parser.svg
[npm-url]: https://npmjs.org/package/screwdriver-config-parser
[downloads-image]: https://img.shields.io/npm/dt/screwdriver-config-parser.svg
[license-image]: https://img.shields.io/npm/l/screwdriver-config-parser.svg
[issues-image]: https://img.shields.io/github/issues/screwdriver-cd/config-parser.svg
[issues-url]: https://github.com/screwdriver-cd/config-parser/issues
[status-image]: https://cd.screwdriver.cd/pipelines/e840cd834b4545320fb95935bcbaa3e1a9c162c3/badge
[status-url]: https://cd.screwdriver.cd/pipelines/e840cd834b4545320fb95935bcbaa3e1a9c162c3
[daviddm-image]: https://david-dm.org/screwdriver-cd/config-parser.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/screwdriver-cd/config-parser

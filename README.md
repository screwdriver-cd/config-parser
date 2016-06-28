# Screwdriver.yaml Configuration Parser
[![Version][npm-image]][npm-url] ![Downloads][downloads-image] [![Build Status][wercker-image]][wercker-url] [![Open Issues][issues-image]][issues-url] [![Dependency Status][daviddm-image]][daviddm-url] ![License][license-image]

> Node module for parsing screwdriver.yaml configurations

## Usage

```bash
npm install screwdriver-config-parser
```

Parse in Node.js

```javascript
const parser = require('screwdriver-config-parser');

parser({
    // Configuration (in YAML form)
    yaml: fs.readFileSync('sample.yaml', 'utf-8'),
    // Name of current job
    jobName: 'main'
}, (err, data) => {
    // data.execute contains the commands to execute
    fs.writeFileSync('execute.json', JSON.stringify(data.execute));
});
```

Or via the command line

```bash
config-parse path/to/screwdriver.yaml job-name path-to-artifacts-dir
```

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
[wercker-image]: https://app.wercker.com/status/1a0ecd0b5c31c377926531a27fe2e4dc
[wercker-url]: https://app.wercker.com/project/bykey/1a0ecd0b5c31c377926531a27fe2e4dc
[daviddm-image]: https://david-dm.org/screwdriver-cd/config-parser.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/screwdriver-cd/config-parser

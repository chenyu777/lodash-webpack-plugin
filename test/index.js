import _ from 'lodash';
import { assert } from 'chai';
import baseConfig from './base.config.js';
import fs from 'fs';
import glob from 'glob';
import { sync as gzipSize } from 'gzip-size';
import MemoryFS from 'memory-fs';
import path from 'path';
import Plugin from '../src/index';
import prettyBytes from 'pretty-bytes';
import { promisify } from 'bluebird';
import webpack from 'webpack';

const memFS = new MemoryFS;

class Config {
  constructor(entryPath, pluginOptions={}) {
    merge(this, {
      'entry': entryPath,
      'plugins': [new Plugin(pluginOptions)]
    }, baseConfig);
  }
}

Object.setPrototypeOf(Config.prototype, null);

class Compiler {
  constructor(config={}) {
    this.compiler = webpack(config);
    this.compiler.outputFileSystem = memFS;
    this.compiler.run = promisify(this.compiler.run, { 'context': this.compiler });
  }

  run() {
    return this.compiler.run();
  }
}

function getTestName(testPath) {
  return path.basename(testPath).split('-').join(' ');
}

const merge = _.partialRight(_.mergeWith, (value, other) => {
  if (_.isArray(value) && _.isArray(other)) {
    return value.concat(other);
  }
});

/*----------------------------------------------------------------------------*/

describe('reduced modular builds', function() {
  this.timeout(0);

  _.each(glob.sync(path.join(__dirname, 'fixtures/*/')), testPath => {
    const testName = getTestName(testPath);
    const actualPath = path.join(testPath, 'actual.js');
    const offPath = path.join(testPath, 'off.json');
    const offConfig = new Config(actualPath, fs.existsSync(offPath) ? require(offPath) : {});
    const onPath = path.join(testPath, 'on.json');
    const onConfig = new Config(actualPath, fs.existsSync(onPath) ? require(onPath) : {});
    const outputPath = path.join(onConfig.output.path, onConfig.output.filename);

    const data = {
      'before': { 'config': onConfig },
      'after': { 'config': offConfig }
    };

    const compile = key => new Compiler(data[key].config).run();

    const complete = key => {
      return stats => {
        const bytes = gzipSize(memFS.readFileSync(outputPath));
        const { length: count } = stats.toJson().modules;
        _.assign(data[key], { bytes, count });
      };
    };

    it(`should work with ${ testName }`, done => {
      compile('before')
        .then(complete('before'))
        .then(() => compile('after'))
        .then(complete('after'))
        .then(() => {
          const { before, after } = data;
          const delta = prettyBytes(before.bytes - after.bytes).replace(/ /g, '');

          assert.ok(before.bytes > after.bytes, `gzip bytes: ${ after.bytes }`);
          assert.ok(before.count >= after.count, `module count: ${ after.count }`);
          this.ctx.test.title += ` (delta: ${ delta })`;
          done();
        })
        .catch(done);
    });
  });

  /*--------------------------------------------------------------------------*/

  _.each(glob.sync(path.join(__dirname, 'clone-fixtures/*/')), testPath => {
    const testName = getTestName(testPath);
    const actualPath = path.join(testPath, 'actual.js');
    const config = new Config(actualPath);
    const plugin = config.plugins[0];

    it(`should enable cloning for explicit \`${ testName }\` use`, done => {
      new Compiler(config).run()
        .then(() => {
          assert.ok(!_.some(plugin.matches, pair => _.endsWith(pair[0], '_baseClone.js')));
          done();
        })
        .catch(done);
    });
  });

  /*--------------------------------------------------------------------------*/

  _.each(glob.sync(path.join(__dirname, 'curry-fixtures/*/')), testPath => {
    const testName = getTestName(testPath);
    const actualPath = path.join(testPath, 'actual.js');
    const config = new Config(actualPath);
    const plugin = config.plugins[0];

    it(`should enable currying for explicit \`${ testName }\` use`, done => {
      new Compiler(config).run()
        .then(() => {
          assert.ok(!_.some(plugin.matches, pair => _.endsWith(pair[0], '_createWrapper.js')));
          done();
        })
        .catch(done);
    });
  });

  /*--------------------------------------------------------------------------*/

  _.each(glob.sync(path.join(__dirname, 'non-fixtures/*/')), testPath => {
    const testName = getTestName(testPath);
    const rePath = RegExp('/' + testName + '(?:/|\\.js$)');
    const actualPath = path.join(testPath, 'actual.js');
    const config = new Config(actualPath);
    const plugin = config.plugins[0];

    it(`should not replace explicit \`${ testName }\` use`, done => {
      new Compiler(config).run()
        .then(() => {
          assert.ok(!_.some(plugin.matches, pair => rePath.test(pair[0])));
          done();
        })
        .catch(done);
    });
  });
});

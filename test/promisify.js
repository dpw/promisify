'use strict';

var util = require('util');
var when = require('when');
var promisify = require('../promisify');

// Some simple support for imposing a time limit on tests

function TestTimeoutError() {
    Error.captureStackTrace(this);
    this.message = "test timed out";
}
util.inherits(TestTimeoutError, Error);
TestTimeoutError.prototype.name = "TestTimeoutError";

function timeout(assert, secs) {
    var orig_done = assert.done;

    var timer = setTimeout(function () {
        if (timer) {
            timer = null;
            assert.done = orig_done;
            throw new TestTimeoutError();
        }
    }, secs * 1000);

    assert.done = function (err) {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        assert.done = orig_done;
        assert.done(err);
    };
}

// A promise that resolves to the given value on the next tick of the
// event loop.
function promptly(val) {
    var d = when.defer();
    process.nextTick(function () { d.resolve(val); });
    return d.promise;
}

// Propogate an error from a promise as a normal exception.
function vent(promise) {
    return promise.then(function () { return promise; },
                        function (err) {
                            // This is the only way to get an exception
                            // out of promises-land
                            process.nextTick(function () { throw err; });
                            return when.defer().promise;
                        });
}

// Wrap a promise-based test.  A test is a is a function that
//  returns a promise that triggers when the test is done.
function tests(assert /* , tests... */) {
    var args = arguments;
    var i = 1;

    // Handle the next promise
    function next() {
        if (i >= args.length) {
            assert.done();
            return null;
        }
        else {
            return args[i++](assert).then(function () { return next(); });
        }
    }

    return vent(next());
}

function ptest(test, expecting) {
    return function (assert) {
        timeout(assert, 5);
        assert.expect(expecting || 1);
        return vent(test(assert).then(function () {
            assert.done();
        }));
    };
}

module.exports.promptly = ptest(function (assert) {
    return promptly(100).then(function (val) {
        assert.equal(val, 100);
    });
});

// Wrap a function in a object, making sure that 'this' gets the right value
function wrap_func(f, assert) {
    var obj = {
        prop: function (/* args */) {
            assert.strictEqual(obj, this);
            return f.apply(null, arguments);
        }
    };
    return obj;
}

function CustomError() {
    Error.captureStackTrace(this);
    this.message = "Oh dear";
}
util.inherits(CustomError, Error);
CustomError.prototype.name = "CustomError";


function cb_error(cb) {
    process.nextTick(function () { cb(new CustomError()); });
}

function double(n) {
    return n * 2;
}

// Convert a function into a function returning a promise
module.exports.func = ptest(function (assert) {
    return promisify.func()(double)(42).then(function (res) {
        assert.equal(res, 84);
    });
});

// Convert a promise yielding a function into a function returning a
// promise
module.exports.func_promise = ptest(function (assert) {
    return promisify.func()(promptly(double))(43).then(function (res) {
        assert.equal(res, 86);
    });
});

// Exceptions should get turned into errors
module.exports.func_error = ptest(function (assert) {
    return promisify.func()(function () { throw new CustomError(); })().then(null, function (err) {
        assert.ok(err instanceof CustomError);
    });
});

// for_property should take care of methods
module.exports.func_for_property = ptest(function (assert) {
    return promisify.func().for_property(wrap_func(double, assert), 'prop')(44).then(function (res) {
        assert.equal(res, 88);
    });
}, 2);

// Transform the result
module.exports.func_transform_result = ptest(function (assert) {
    return promisify.func(function (p) { return p.then(double); })(double)(45).then(function (res) {
        assert.equal(res, 180);
    });
});


function cb_identity(val, cb) {
    process.nextTick(function () { cb(null, val); });
}

// Convert cb_identity into a function returning a promise.
module.exports.cb_func = ptest(function (assert) {
    return promisify.cb_func()(cb_identity)(42).then(function (res) {
        assert.equal(res, 42);
    });
});

// Convert a promise yielding cb_identity into a function returning a
// promise.
module.exports.cb_func_promise = ptest(function (assert) {
    return promisify.cb_func()(promptly(cb_identity))(43).then(function (res) {
        assert.equal(res, 43);
    });
});

// Convert a promise yielding an object with a cb_identity property
// into a function returning a promise.
module.exports.cb_func_promise_obj = ptest(function (assert) {
    return promisify.cb_func().for_property(promptly(wrap_func(cb_identity, assert)), 'prop')(44).then(function (res) {
        assert.equal(res, 44);
    });
}, 2);

// And now the same again for errors
module.exports.cb_func_error = ptest(function (assert) {
    return promisify.cb_func()(cb_error)().then(null, function (err) {
        assert.ok(err instanceof CustomError);
    });
});

module.exports.cb_func_promise_error = ptest(function (assert) {
    return promisify.cb_func()(promptly(cb_error))().then(null, function (err) {
        assert.ok(err instanceof CustomError);
    });
});

module.exports.cb_func_promise_obj_error = ptest(function (assert) {
    return promisify.cb_func().for_property(promptly(wrap_func(cb_error, assert)), 'prop')().then(null, function (err) {
        assert.ok(err instanceof CustomError);
    });
}, 2);

// Do a transformation of the result
module.exports.cb_func_transform_result = ptest(function (assert) {
    return promisify.cb_func(function (p) { return p.then(double); })(cb_identity)(42).then(function (res) {
        assert.equal(res, 84);
    });
});


function cb_identity_vo(val, cb) {
    process.nextTick(function () { cb(val); });
}

// A value-only callback
module.exports.cb_func_value_only = ptest(function (assert) {
    return promisify.cb_func_value_only()(cb_identity_vo)(42).then(function (res) {
        assert.equal(res, 42);
    });
});


// A function in an object
module.exports.object_func = ptest(function (assert) {
    return promisify.object({prop: promisify.func()})(wrap_func(double, assert)).prop(42).then(function (res) {
        assert.equal(res, 84);
    });
}, 2);

// A callback function in an object
module.exports.object_cb_func = ptest(function (assert) {
    return promisify.object({prop: promisify.cb_func()})(wrap_func(cb_identity, assert)).prop(43).then(function (res) {
        assert.equal(res, 43);
    });
}, 2);

// TODO Test nested objects

// Make a simple read stream
function test_read_stream() {
    var EventEmitter = require('events').EventEmitter;
    var stream = new EventEmitter();
    var i = 1;
    function next() {
        if (i <= 5) {
            stream.emit('data', String(i++));
            process.nextTick(next);
        }
        else {
            stream.emit('end');
        }
    }
    process.nextTick(next);
    return stream;
}

// Accumulate items from the test stream into a buffer
module.exports.read_stream = ptest(function (assert) {
    var buf = '';
    return promisify.read_stream()(test_read_stream()).map(function (val) { buf += val; }).then(function () {
        assert.equal(buf, '12345');
    });
});

// In conjunction with promisify.func to convert a read stream
// returned from a method
module.exports.read_stream_func = ptest(function (assert) {
    var buf = '';
    return promisify.func(promisify.read_stream()).for_property(promptly(wrap_func(test_read_stream, assert)), 'prop')().map(function (val) { buf += val; }).then(function () {
        assert.equal(buf, '12345');
    });
}, 2);

// Test error case
module.exports.read_stream_error = ptest(function (assert) {
    return promisify.read_stream()(test_read_stream()).map(function (val) { throw new CustomError(); }).then(null, function (err) {
        assert.ok(err instanceof CustomError);
    });
});

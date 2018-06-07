const Node = require('./lib/node')
const Get = require('./lib/get')
const Put = require('./lib/put')
const Batch = require('./lib/batch')
const Delete = require('./lib/del')
const History = require('./lib/history')
const Iterator = require('./lib/iterator')
const { Header } = require('./lib/messages')
const mutexify = require('mutexify')
const thunky = require('thunky')
const codecs = require('codecs')
const bulk = require('bulk-write-stream')
const toStream = require('nanoiterator/to-stream')
const isOptions = require('is-options')

module.exports = HyperTrie

function HyperTrie (feed, opts) {
  if (!(this instanceof HyperTrie)) return new HyperTrie(feed, opts)
  if (!opts) opts = {}

  this.feed = feed
  this.opened = false
  this.valueEncoding = opts.valueEncoding ? codecs(opts.valueEncoding) : null
  this.ready = thunky(this._ready.bind(this))

  this._checkout = (opts && opts.checkout) || 0
  this._lock = mutexify()
}

Object.defineProperty(HyperTrie.prototype, 'version', {
  enumerable: true,
  get: function () {
    return this.feed.length
  }
})

HyperTrie.prototype._ready = function (cb) {
  const self = this

  this.feed.ready(function (err) {
    if (err) return done(err)

    if (self.feed.length) return done(null)
    self.feed.append(Header.encode({protocol: 'hypertrie'}), done)

    function done (err) {
      if (err) return cb(err)
      self.opened = true
      cb(null)
    }
  })
}

HyperTrie.prototype.checkout = function (version) {
  return new HyperTrie(this.feed, {
    checkout: version || -1,
    valueEncoding: this.valueEncoding
  })
}

HyperTrie.prototype.head = function (cb) {
  if (!this.opened) return readyAndHead(this, cb)
  if (this._checkout !== 0) return this.getBySeq(this._checkout, cb)
  if (this.feed.length < 2) return cb(null, null)
  this.getBySeq(this.feed.length - 1, cb)
}

HyperTrie.prototype.iterator = function (prefix, opts) {
  if (isOptions(prefix)) return this.iterator('', prefix)
  return new Iterator(this, prefix, opts)
}

HyperTrie.prototype.createReadStream = function (prefix, opts) {
  return toStream(this.iterator(prefix, opts))
}

HyperTrie.prototype.history = function (opts) {
  return new History(this, opts)
}

HyperTrie.prototype.createHistoryStream = function (opts) {
  return toStream(this.history(opts))
}

HyperTrie.prototype.get = function (key, opts, cb) {
  if (typeof opts === 'function') return this.get(key, null, opts)
  return new Get(this, key, opts, cb)
}

HyperTrie.prototype.batch = function (ops, cb) {
  return new Batch(this, ops, cb || noop)
}

HyperTrie.prototype.put = function (key, value, cb) {
  return new Put(this, key, value, null, 0, cb || noop)
}

HyperTrie.prototype.del = function (key, cb) {
  return new Delete(this, key, cb)
}

HyperTrie.prototype.createWriteStream = function (opts) {
  const self = this
  return bulk.obj(write)

  function write (batch, cb) {
    if (batch.length && Array.isArray(batch[0])) batch = flatten(batch)
    self.batch(batch, cb)
  }
}

HyperTrie.prototype.getBySeq = function (seq, cb) {
  const self = this
  this.feed.get(seq, onnode)

  function onnode (err, val) {
    if (err) return cb(err)
    const node = Node.decode(val, seq, self.valueEncoding)
    cb(null, node)
  }
}

function noop () {}

function readyAndHead (self, cb) {
  self.ready(function (err) {
    if (err) return cb(err)
    self.head(cb)
  })
}

function flatten (list) {
  const result = []
  for (var i = 0; i < list.length; i++) {
    const next = list[i]
    for (var j = 0; j < next.length; j++) result.push(next[j])
  }
  return result
}

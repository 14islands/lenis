import EventEmitter from 'tiny-emitter'
import VirtualScroll from 'virtual-scroll'
import { version } from '../package.json'
import { clamp } from './maths.js'

class Animate {
  to(target, { duration = 1, easing = (t) => t, ...keys } = {}) {
    this.target = target
    this.fromKeys = { ...keys }
    this.toKeys = { ...keys }
    this.keys = Object.keys({ ...keys })

    // get initial values
    this.keys.forEach((key) => {
      this.fromKeys[key] = target[key]
    })

    this.duration = duration
    this.easing = easing
    this.currentTime = 0
    this.isRunning = true
  }

  stop() {
    this.isRunning = false
  }

  raf(deltaTime) {
    if (!this.isRunning) return

    this.currentTime = Math.min(this.currentTime + deltaTime, this.duration)

    const progress = this.easing(this.progress)

    this.keys.forEach((key) => {
      const from = this.fromKeys[key]
      const to = this.toKeys[key]

      const value = from + (to - from) * progress

      this.target[key] = value
    })

    if (progress === 1) {
      this.stop()
    }
  }

  get progress() {
    return this.currentTime / this.duration
  }
}

export default class Lenis extends EventEmitter {
  /**
   * @typedef {(t: number) => number} EasingFunction
   * @typedef {'vertical' | 'horizontal'} Direction
   * @typedef {'vertical' | 'horizontal' | 'both'} GestureDirection
   *
   * @typedef LenisOptions
   * @property {number} [duration]
   * @property {EasingFunction} [easing]
   * @property {boolean} [smooth]
   * @property {boolean} [smoothTouch]
   * @property {number} [touchMultiplier]
   * @property {Direction} [direction]
   * @property {GestureDirection} [gestureDirection]
   * @property {Window | HTMLElement} [wrapper]
   * @property {HTMLElement} [content]
   *
   * @param {LenisOptions}
   */
  constructor({
    duration = 1.2,
    easing = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)), // https://easings.net/en#easeOutExpo
    smooth = true,
    smoothTouch = false,
    touchMultiplier = 2,
    direction = 'vertical', // vertical, horizontal
    gestureDirection = 'vertical', // vertical, horizontal, both
    wrapper = window,
    content = document.body,
  } = {}) {
    super()

    window.lenisVersion = version

    this.options = {
      duration,
      easing,
      smooth,
      smoothTouch,
      touchMultiplier,
      direction,
      gestureDirection,
      wrapper,
      content,
    }

    this.duration = duration
    this.easing = easing
    this.smooth = smooth
    this.smoothTouch = smoothTouch
    this.touchMultiplier = touchMultiplier
    this.direction = direction
    this.gestureDirection = gestureDirection
    this.wrapperNode = wrapper
    this.contentNode = content

    this.wrapperNode.addEventListener('scroll', this.onScroll)

    //observe wrapper node size
    if (this.wrapperNode === window) {
      this.wrapperNode.addEventListener('resize', this.onWindowResize)
      this.onWindowResize()
    } else {
      this.wrapperHeight = this.wrapperNode.offsetHeight
      this.wrapperWidth = this.wrapperNode.offsetWidth

      //observe wrapper node size
      this.wrapperObserver = new ResizeObserver(this.onWrapperResize)
      this.wrapperObserver.observe(this.wrapperNode)
    }

    this.contentHeight = this.contentNode.offsetHeight
    this.contentWidth = this.contentNode.offsetWidth

    //observe content node size
    this.contentObserver = new ResizeObserver(this.onContentResize)
    this.contentObserver.observe(this.contentNode)

    //set initial scroll position
    this.targetScroll =
      this.scroll =
      this.lastScroll =
        this.wrapperNode[this.scrollProperty]

    this.animate = new Animate()

    const platform =
      navigator?.userAgentData?.platform || navigator?.platform || 'unknown'

    // listen and normalize wheel event cross-browser
    this.virtualScroll = new VirtualScroll({
      el: this.wrapperNode,
      firefoxMultiplier: 50,
      mouseMultiplier: platform.includes('Win') ? 1 : 0.4,
      useKeyboard: false,
      touchMultiplier: this.touchMultiplier,
      useTouch: true,
      passive: false,
    })

    this.virtualScroll.on(this.onVirtualScroll)
  }

  get scrollProperty() {
    let property
    if (this.wrapperNode === window) {
      property = this.direction === 'horizontal' ? 'scrollX' : 'scrollY'
    } else {
      property = this.direction === 'horizontal' ? 'scrollLeft' : 'scrollTop'
    }
    return property
  }

  start() {
    this.stopped = false
  }

  stop() {
    this.stopped = true
    this.animate.stop()
  }

  destroy() {
    if (this.wrapperNode === window) {
      this.wrapperNode.removeEventListener('resize', this.onWindowResize)
    }
    this.wrapperNode.removeEventListener('scroll', this.onScroll)

    this.virtualScroll.destroy()
    this.wrapperObserver?.disconnect()
    this.contentObserver.disconnect()
  }

  onWindowResize = () => {
    this.wrapperWidth = window.innerWidth
    this.wrapperHeight = window.innerHeight
  }

  onWrapperResize = ([entry]) => {
    if (entry) {
      const rect = entry.contentRect
      this.wrapperWidth = rect.width
      this.wrapperHeight = rect.height
    }
  }

  onContentResize = ([entry]) => {
    if (entry) {
      const rect = entry.contentRect
      this.contentWidth = rect.width
      this.contentHeight = rect.height
    }
  }

  get limit() {
    return this.direction === 'horizontal'
      ? this.contentWidth - this.wrapperWidth
      : this.contentHeight - this.wrapperHeight
  }

  onVirtualScroll = ({ deltaY, deltaX, originalEvent: e }) => {
    if (e.ctrlKey) return

    // switch to smooth if event is touch and touch is true
    this.smooth = !!e.changedTouches ? this.smoothTouch : this.options.smooth

    if (this.stopped) {
      e.preventDefault()
      return
    }

    if (!this.smooth) return

    // fix wheel holding scroll https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/buttons
    if (e.buttons === 4) return

    // prevent native wheel scrolling
    if (this.smooth) e.preventDefault()

    let delta = 0
    if (this.gestureDirection === 'both') {
      delta = deltaX + deltaY
    } else if (this.gestureDirection === 'horizontal') {
      delta = deltaX
    } else {
      // vertical
      delta = deltaY
    }

    this.targetScroll -= delta
    this.targetScroll = clamp(0, this.targetScroll, this.limit)

    this.scrollTo(this.targetScroll)
  }

  raf(now) {
    const deltaTime = now - (this.now || 0)
    this.now = now

    if (this.stopped || !this.smooth) return

    this.lastScroll = this.scroll

    // where this.scroll is updated
    this.animate.raf(deltaTime * 0.001)

    if (this.scroll === this.targetScroll) {
      // if target reached velocity should be 0
      this.lastScroll = this.scroll
    }

    if (this.isScrolling) {
      this.setScroll(this.scroll)
      this.notify()
    }

    this.isScrolling = this.scroll !== this.targetScroll
  }

  get velocity() {
    return this.scroll - this.lastScroll
  }

  setScroll(value) {
    this.direction === 'horizontal'
      ? this.wrapperNode.scrollTo(value, 0)
      : this.wrapperNode.scrollTo(0, value)
  }

  onScroll = (e) => {
    // if isScrolling false we can consider user isn't scrolling with wheel (cmd+F, keyboard or whatever). So we must scroll to value immediately
    if (!this.isScrolling || !this.smooth) {
      // where native scroll happens
      this.targetScroll =
        this.scroll =
        this.lastScroll =
          this.wrapperNode[this.scrollProperty]

      this.notify()
    }
  }

  notify() {
    this.emit('scroll', {
      scroll: this.scroll,
      limit: this.limit,
      velocity: this.velocity,
      direction: this.direction,
      progress: this.scroll / this.limit,
    })
  }

  scrollTo(
    target,
    {
      offset = 0,
      immediate = false,
      duration = this.duration,
      easing = this.easing,
    } = {}
  ) {
    if (target === undefined || target === null) return
    let value

    if (typeof target === 'number') {
      value = target
    } else if (target === 'top' || target === '#top') {
      value = 0
    } else if (target === 'bottom') {
      value = this.limit
    } else {
      let node

      if (typeof target === 'string') {
        // CSS selector
        node = document.querySelector(target)
      } else if (target?.nodeType) {
        // Node element
        node = target
      } else {
        return
      }

      if (!node) return
      let wrapperOffset = 0

      if (this.wrapperNode !== window) {
        const wrapperRect = this.wrapperNode.getBoundingClientRect()
        wrapperOffset =
          this.direction === 'horizontal' ? wrapperRect.left : wrapperRect.top
      }

      const rect = node.getBoundingClientRect()

      value =
        (this.direction === 'horizontal' ? rect.left : rect.top) +
        this.scroll -
        wrapperOffset
    }

    value += offset

    this.targetScroll = clamp(0, value, this.limit)

    if (!this.smooth || immediate) {
      this.setScroll(this.targetScroll)
    } else {
      this.animate.to(this, {
        duration,
        easing,
        scroll: this.targetScroll,
      })
    }
  }
}

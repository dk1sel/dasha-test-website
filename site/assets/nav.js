// Fixierte Navigationsleiste: oben auf dem Titelbild transparent, nach dem Scrollen
// mit dunklem Hintergrund und etwas kompakter.
(function () {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  const update = () => bar.classList.toggle('is-scrolled', window.scrollY > 8);
  update();
  window.addEventListener('scroll', update, { passive: true });
})();

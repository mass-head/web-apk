document.addEventListener('DOMContentLoaded', () => {
  // 1. Origin and diagnostics
  const originDisplay = document.getElementById('origin-display');
  const diagProto = document.getElementById('diag-proto');
  const diagUa = document.getElementById('diag-ua');
  const diagRes = document.getElementById('diag-res');

  if (originDisplay) {
    originDisplay.textContent = window.location.origin;
  }
  if (diagProto) {
    diagProto.textContent = window.location.protocol;
  }
  if (diagUa) {
    diagUa.textContent = navigator.userAgent;
    diagUa.title = navigator.userAgent;
  }
  if (diagRes) {
    diagRes.textContent = `${window.screen.width} x ${window.screen.height} (${window.devicePixelRatio}x)`;
  }

  // 2. Interactive Counter
  let count = 0;
  const counterVal = document.getElementById('counter-val');
  const btnInc = document.getElementById('btn-increment');
  const btnDec = document.getElementById('btn-decrement');

  if (btnInc && counterVal) {
    btnInc.addEventListener('click', () => {
      count++;
      counterVal.textContent = count;
    });
  }

  if (btnDec && counterVal) {
    btnDec.addEventListener('click', () => {
      count--;
      counterVal.textContent = count;
    });
  }
});

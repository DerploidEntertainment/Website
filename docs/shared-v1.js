if (document.readyState != 'loading')
    ready();
else
    document.addEventListener('DOMContentLoaded', ready);

function ready() {
    updateCurrentYearText();
}

function updateCurrentYearText() {
    const currYearStr = new Date().getUTCFullYear().toString();
    const currentYearTexts = document.getElementsByClassName("derp-js-current-year");
    for (const txt of currentYearTexts)
        txt.textContent = currYearStr;
}
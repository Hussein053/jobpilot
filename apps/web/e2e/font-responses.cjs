// Fixture typography never downloads remote font files.
module.exports = {
  "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap":
    "@font-face { font-family: 'Archivo'; src: local('Arial'); font-weight: 100 900; }",
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100..800&display=swap":
    "@font-face { font-family: 'JetBrains Mono'; src: local('monospace'); font-weight: 100 800; }",
};

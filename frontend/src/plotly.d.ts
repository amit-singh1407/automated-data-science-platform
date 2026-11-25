declare module "plotly.js-dist-min" {
  const Plotly: {
    newPlot: (element: HTMLElement, data: object[], layout?: object, config?: object) => Promise<void>;
    react: (element: HTMLElement, data: object[], layout?: object, config?: object) => Promise<void>;
    purge: (element: HTMLElement) => void;
  };
  export default Plotly;
}

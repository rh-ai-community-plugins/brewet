const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const { ModuleFederationPlugin } = webpack.container;
const path = require('path');
const { version, 'module-federation': moduleFederation } = require('../package.json');
const stylePaths = require('./stylePaths');

const remoteEntry = path.posix.join(moduleFederation.remoteEntry);

module.exports = {
  entry: './src/index.ts',
  output: {
    publicPath: 'auto',
    filename: '[name].[contenthash].js',
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            compilerOptions: {
              noEmit: false,
            },
          },
        },
        include: /src/,
        exclude: /\.test\.(ts|tsx)$/,
      },
      {
        test: /\.css$/,
        use: [
          {
            loader: 'style-loader',
          },
          {
            loader: 'css-loader',
          },
        ],
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg|woff2?|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
    alias: {
      '~': path.resolve(__dirname, '../src'),
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, '../src/index.html'),
    }),
    new webpack.DefinePlugin({
      'process.env.STORAGE_BACKEND_IMAGE': JSON.stringify(
        process.env.STORAGE_BACKEND_IMAGE ||
          `quay.io/rh-ai-community-plugins/brewet-storage-backend:${version}`,
      ),
      'process.env.BFF_BASE_URL': JSON.stringify(
        process.env.BFF_BASE_URL || '',
      ),
    }),
    new ModuleFederationPlugin({
      name: 'brewet', // [PLUGIN-SPECIFIC] must match package.json and plugin.yaml
      filename: remoteEntry,
      exposes: {
        './extensions': './src/rhoai/extensions.ts',
        './Icon': './src/app/components/BrewetNavIcon.tsx',
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: '^18',
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^18',
        },
        'react-router-dom': {
          singleton: true,
          requiredVersion: '^6',
        },
        '@patternfly/react-core': {
          singleton: true,
          requiredVersion: '^6',
        },
        '@openshift/dynamic-plugin-sdk': {
          singleton: true,
          requiredVersion: '^5',
        },
      },
    }),
  ],
};

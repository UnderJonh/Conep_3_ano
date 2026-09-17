export const Asset = {
  fromModule(resource) {
    return { uri: typeof resource === 'string' ? resource : resource.uri, async downloadAsync() {} };
  },
};

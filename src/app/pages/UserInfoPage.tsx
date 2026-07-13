import React from 'react';
import {
  PageSection,
  Title,
  Content,
  Card,
  CardBody,
  CardTitle,
  Stack,
  StackItem,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Spinner,
  Bullseye,
  Alert,
  Label,
} from '@patternfly/react-core';
import { UserIcon, LockIcon } from '@patternfly/react-icons';
import { useCurrentUser } from '~/app/hooks/useCurrentUser';

const UserInfoPage: React.FC = () => {
  const { user, loading: userLoading, error: userError } = useCurrentUser();

  if (userLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading user information" />
        </Bullseye>
      </PageSection>
    );
  }

  return (
    <PageSection>
      <Stack hasGutter>
        <StackItem>
          <Title headingLevel="h1" size="2xl">
            <UserIcon /> Welcome to Brewet
          </Title>
          <Content component="p">
            This page demonstrates how to retrieve and display the authenticated user&apos;s
            information through the dashboard&apos;s backend APIs.
          </Content>
        </StackItem>

        {userError && (
          <StackItem>
            <Alert variant="danger" title="Failed to load user information" isInline>
              {userError}
            </Alert>
          </StackItem>
        )}

        {user && (
          <StackItem>
            <Card>
              <CardTitle>
                <UserIcon /> User Information
              </CardTitle>
              <CardBody>
                <DescriptionList isHorizontal>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Username</DescriptionListTerm>
                    <DescriptionListDescription>{user.userName}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>User ID</DescriptionListTerm>
                    <DescriptionListDescription>{user.userID}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Admin</DescriptionListTerm>
                    <DescriptionListDescription>
                      <Label color={user.isAdmin ? 'green' : 'blue'}>
                        {user.isAdmin ? 'Yes' : 'No'}
                      </Label>
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Cluster ID</DescriptionListTerm>
                    <DescriptionListDescription>{user.clusterID}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Cluster Branding</DescriptionListTerm>
                    <DescriptionListDescription>{user.clusterBranding}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Default Namespace</DescriptionListTerm>
                    <DescriptionListDescription>{user.namespace}</DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </CardBody>
            </Card>
          </StackItem>
        )}

        {user?.isAdmin && (
          <StackItem>
            <Card>
              <CardTitle>
                <LockIcon /> Admin-Only Section
              </CardTitle>
              <CardBody>
                If you can see this section, you are logged in as a RHOAI admin.
              </CardBody>
            </Card>
          </StackItem>
        )}
      </Stack>
    </PageSection>
  );
};

export default UserInfoPage;

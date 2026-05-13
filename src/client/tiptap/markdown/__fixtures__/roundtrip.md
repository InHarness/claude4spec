# Sample spec

This paragraph mentions an endpoint <inline_mention type="endpoint" slug="get-api-users"/> in the middle of prose.

## Inline in list

- Users can call <inline_mention type="endpoint" slug="create-user"/> to register.
- Response shape defined by <inline_mention type="dto" slug="user-response"/>.

## Block cards

<single_element type="endpoint" slug="get-api-users"/>

<single_element type="dto" slug="user-response"/>

## Static lists

<element_list type="endpoint" slugs="get-api-users,create-user,delete-user"/>

<element_list type="dto" slugs="user-response,error-response"/>

## Dynamic lists

<tagged_list type="endpoint" tags="auth,public" filter="or"/>

<tagged_list type="dto" tags="auth"/>

## Mixed list

<tagged_list_mixed tags="auth,billing" filter="and"/>

<tagged_list_mixed tags="public"/>
